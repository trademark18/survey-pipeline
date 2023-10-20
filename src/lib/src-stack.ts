import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as fs from 'fs';
import * as events from 'aws-cdk-lib/aws-events';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';

export class DreedLectureAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket
    const bucket = new s3.Bucket(this, 'Bucket', {});

    // Load S3 bucket with files
    new s3deploy.BucketDeployment(this, 'DeployFiles', {
      sources: [s3deploy.Source.asset('assets/s3-files')],
      destinationBucket: bucket,
    });

    // Create a state machine role that will allow invoking the lambda defined above and writing to the ddb table defined above
    const processSurveySfnRole = new iam.Role(this, 'StateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
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

    const updateSiteSfnRole = new iam.Role(this, 'UpdateSiteStateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
    });

    const calculateStatsSfnRole = new iam.Role(
      this,
      'CalculateStatsStateMachineRole',
      {
        assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      },
    );

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
      environment: {
        BUCKET_NAME: bucket.bucketName,
        key: 'RetreatSurvey.jpg',
      },
      initialPolicy: [textractPolicy],
    });

    docParserLambda.grantInvoke(processSurveySfnRole);
    bucket.grantRead(docParserLambda);

    // DynamoDB Table
    const surveyTable = new dynamodb.Table(this, 'SurveyAppTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    surveyTable.grantWriteData(processSurveySfnRole);
    surveyTable.grantReadData(calculateStatsSfnRole);

    const connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    connectionsTable.grantReadData(updateSiteSfnRole);

    // Event bus
    const eventBus = new events.EventBus(this, 'DreedSurveyAppEventBus', {});
    eventBus.grantPutEventsTo(processSurveySfnRole);
    eventBus.grantPutEventsTo(calculateStatsSfnRole);

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
          EventBusName: eventBus.eventBusName,
        },
        roleArn: processSurveySfnRole.roleArn,
      },
    );

    // Update Site Step Function
    const updateSiteStateMachineDefinition = fs
      .readFileSync('statemachines/update-site.asl.json')
      .toString();

    // $connect handler Lambda
    const connectHandler = new lambda.Function(this, 'ConnectHandler', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/connect-handler'),
      environment: {
        TableName: connectionsTable.tableName,
        EventBusName: eventBus.eventBusName,
      },
    });

    eventBus.grantPutEventsTo(connectHandler);

    // $disconnect handler Lambda
    const disconnectHandler = new lambda.Function(this, 'DisconnectHandler', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/disconnect-handler'),
      environment: {
        TableName: connectionsTable.tableName,
      },
    });

    connectionsTable.grantWriteData(connectHandler);
    connectionsTable.grantWriteData(disconnectHandler);

    // API Gateway WSS API
    const webSocketApi = new apigwv2.WebSocketApi(
      this,
      'dreedSurveyAppWebSocketApi',
    );
    const wssStage = new apigwv2.WebSocketStage(this, 'testStage', {
      webSocketApi,
      stageName: 'test',
      autoDeploy: true,
    });

    webSocketApi.addRoute('$connect', {
      integration: new WebSocketLambdaIntegration('$connect', connectHandler),
    });
    webSocketApi.addRoute('$disconnect', {
      integration: new WebSocketLambdaIntegration(
        '$disconnect',
        disconnectHandler,
      ),
    });

    // Update Site Step function
    const cfnUpdateSiteStateMachine = new sfn.CfnStateMachine(
      this,
      'UpdateSiteStateMachine',
      {
        definitionString: updateSiteStateMachineDefinition,
        definitionSubstitutions: {
          TableName: connectionsTable.tableName,
          WssEndpoint: webSocketApi.apiEndpoint,
          WssStageName: wssStage.stageName,
          BucketName: bucket.bucketName,
        },
        roleArn: updateSiteSfnRole.roleArn,
      },
    );

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
      },
    );

    const calculateStatsStateMachine = new sfn.CfnStateMachine(
      this,
      'CalculateStatsStateMachine',
      {
        definitionString: calculateStatsStateMachineDefinition,
        definitionSubstitutions: {
          SurveyTableName: surveyTable.tableName,
          EventBusName: eventBus.eventBusName,
          CalculateStatsLambdaArn: calculateStatsLambda.functionArn,
        },
        roleArn: processSurveySfnRole.roleArn,
      },
    );

    surveyTable.grantReadData(calculateStatsLambda);
    calculateStatsLambda.grantInvoke(calculateStatsSfnRole);
    eventBus.grantPutEventsTo(calculateStatsSfnRole);

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
      eventBusName: eventBus.eventBusName,
      roleArn: calculateStatsTriggerRole.roleArn,
      eventPattern: {
        source: ['survey-app'],
        detailType: ['result-generated'],
      },
      targets: [
        {
          arn: calculateStatsStateMachine.attrArn,
          id: 'CalculateStats',
        },
      ],
    });

    // Add a role allowing an EventBridge rule to trigger the update site state machine
    const updateSiteTriggerRole = new iam.Role(this, 'UpdateSiteTriggerRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
      inlinePolicies: {
        StepFunctionsPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['states:StartExecution'],
              resources: [cfnUpdateSiteStateMachine.attrArn],
            }),
          ],
        }),
      },
    });

    // Add EventBridge rule to trigger update site state machine on "stats-updated" event
    const updateSiteRule = new events.CfnRule(this, 'UpdateSiteRule', {
      eventBusName: eventBus.eventBusName,
      roleArn: updateSiteTriggerRole.roleArn,
      eventPattern: {
        source: ['survey-app'],
        detailType: ['stats-updated'],
      },
      targets: [
        {
          arn: cfnUpdateSiteStateMachine.attrArn,
          id: 'UpdateSite',
        },
      ],
    });
  }
}
