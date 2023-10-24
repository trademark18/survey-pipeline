import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as fs from 'fs';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as pipes from 'aws-cdk-lib/aws-pipes';

export interface IParsingPipelineParams {
  readonly sourceBucket: cdk.aws_s3.Bucket;
  readonly eventBus: cdk.aws_events.EventBus;
  readonly ingestQueue: cdk.aws_sqs.Queue;
}

export class ParsingPipelineConstruct extends Construct {
  constructor(scope: Construct, id: string, params: IParsingPipelineParams) {
    super(scope, id);

    const xraySfnPolicy = new iam.ManagedPolicy(this, 'XraySfnPolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'xray:PutTraceSegments',
            'xray:PutTelemetryRecords',
            'xray:GetSamplingRules',
            'xray:GetSamplingTargets',
          ],
          resources: ['*'],
        }),
      ],
    });

    // Create a state machine role that will allow invoking the lambda defined above and writing to the ddb table defined above
    const processSurveySfnRole = new iam.Role(this, 'StateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      managedPolicies: [xraySfnPolicy],
      inlinePolicies: {
        ComprehendPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['comprehend:DetectSentiment'],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Grant permission to use Amazon Textract
    const textractPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['textract:AnalyzeDocument'],
      resources: ['*'],
    });

    // Lambda function
    const docParserLambda = new lambda.Function(this, 'DocParser', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/doc-parser'),
      timeout: cdk.Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        BUCKET_NAME: params.sourceBucket.bucketName,
        key: 'NegativeSurvey.jpg',
      },
      initialPolicy: [textractPolicy],
    });

    // Update permissions
    docParserLambda.grantInvoke(processSurveySfnRole);

    params.sourceBucket.grantRead(docParserLambda);

    // Calculate stats step function role
    const calculateStatsSfnRole = new iam.Role(
      this,
      'CalculateStatsStateMachineRole',
      {
        managedPolicies: [xraySfnPolicy],
        assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      },
    );

    // DynamoDB Table for survey results
    const surveyTable = new dynamodb.Table(this, 'SurveyAppTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    surveyTable.grantWriteData(processSurveySfnRole);
    surveyTable.grantReadData(calculateStatsSfnRole);

    calculateStatsSfnRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Scan'],
        resources: [surveyTable.tableArn],
      }),
    );

    // Grant permission publish events
    params.eventBus.grantPutEventsTo(processSurveySfnRole);
    params.eventBus.grantPutEventsTo(calculateStatsSfnRole);

    // Load statemachines/survey-processor.asl.json file contents from disk
    const surveyProcessorStateMachineDefinition = fs
      .readFileSync('statemachines/survey-processor.asl.json')
      .toString();

    // Step function
    const processSurveySfn = new sfn.CfnStateMachine(
      this,
      'DocParserStateMachine',
      {
        definitionString: surveyProcessorStateMachineDefinition,
        definitionSubstitutions: {
          TableName: surveyTable.tableName,
          DocParserLambda: docParserLambda.functionArn,
          EventBusName: params.eventBus.eventBusName,
        },
        roleArn: processSurveySfnRole.roleArn,
        tracingConfiguration: {
          enabled: true,
        },
      },
    );

    // Role for the Pipe
    const pipeRole = new iam.Role(this, 'PipeRole', {
      assumedBy: new iam.ServicePrincipal('pipes.amazonaws.com'),
      inlinePolicies: {
        StepFunctionsPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['states:StartExecution'],
              resources: [processSurveySfn.attrArn],
            }),
          ],
        }),
        SqsPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
              ],
              resources: [params.ingestQueue.queueArn],
            }),
          ],
        }),
      },
    });

    // Create an EventBridge Pipe that hooks a step function to the ingest queue
    new pipes.CfnPipe(this, 'IngestPipe', {
      source: params.ingestQueue.queueArn,
      target: processSurveySfn.attrArn,
      targetParameters: {
        stepFunctionStateMachineParameters: {
          invocationType: 'FIRE_AND_FORGET',
        },
      },
      roleArn: pipeRole.roleArn,
    });

    // Calculate stats step function
    const calculateStatsStateMachineDefinition = fs
      .readFileSync('statemachines/calculate-stats.asl.json')
      .toString();

    // Calculate stats Lambda
    const calculateStatsLambda = new lambda.Function(
      this,
      'CalculateStatsLambda',
      {
        runtime: lambda.Runtime.NODEJS_LATEST,
        handler: 'index.handler',
        code: lambda.Code.fromAsset('lambda/calculate-stats'),
        environment: {
          SurveyTableName: surveyTable.tableName,
        },
        tracing: lambda.Tracing.ACTIVE,
      },
    );

    const calculateStatsStateMachine = new sfn.CfnStateMachine(
      this,
      'CalculateStatsStateMachine',
      {
        definitionString: calculateStatsStateMachineDefinition,
        definitionSubstitutions: {
          SurveyTableName: surveyTable.tableName,
          EventBusName: params.eventBus.eventBusName,
          CalculateStatsLambdaArn: calculateStatsLambda.functionArn,
        },
        roleArn: calculateStatsSfnRole.roleArn,
        tracingConfiguration: {
          enabled: true,
        },
      },
    );

    surveyTable.grantReadData(calculateStatsLambda);
    calculateStatsLambda.grantInvoke(calculateStatsSfnRole);
    params.eventBus.grantPutEventsTo(calculateStatsSfnRole);

    // Add a role allowing an EventBridge rule to trigger the calculateStatsStateMachine
    const calculateStatsTriggerRole = new iam.Role(
      this,
      'CalculateStatsTriggerRole',
      {
        assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
        inlinePolicies: {
          StepFunctionsPolicy: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['states:StartExecution'],
                resources: [calculateStatsStateMachine.attrArn],
              }),
            ],
          }),
        },
      },
    );

    // Add EventBridge rule to trigger calculateStatsStateMachine on "report-ready" event
    const calculateStatsRule = new events.CfnRule(this, 'CalculateStatsRule', {
      eventBusName: params.eventBus.eventBusName,
      eventPattern: {
        source: ['survey-app'],
        'detail-type': ['result-generated'],
      },
      targets: [
        {
          arn: calculateStatsStateMachine.attrArn,
          id: 'CalculateStats',
          roleArn: calculateStatsTriggerRole.roleArn,
        },
      ],
    });
  }
}
