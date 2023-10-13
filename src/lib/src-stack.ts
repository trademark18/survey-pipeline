import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as fs from 'fs';

export class DreedLectureAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket
    const bucket = new s3.Bucket(this, 'Bucket', {});

    // Load S3 bucket with files
    new s3deploy.BucketDeployment(this, 'DeployFiles', {
      sources: [s3deploy.Source.asset('assets/s3-files')],
      destinationBucket: bucket
    });

    // Create a state machine role that will allow invoking the lambda defined above and writing to the ddb table defined above
    const stateMachineRole = new iam.Role(this, 'StateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        'ComprehendPolicy': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['comprehend:DetectSentiment'],
              resources: ['*']
            })
          ]
        })
      }
    });

    // Grant permission to use Amazon Textract
    const textractPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['textract:AnalyzeDocument'],
      resources: ['*']
    });

    // Lambda function
    const docParserLambda = new lambda.Function(this, 'DocParser', { 
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/doc-parser'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        BUCKET_NAME: bucket.bucketName,
        key: 'RetreatSurvey.jpg'
      },
      initialPolicy: [
        textractPolicy
      ]
    });

    docParserLambda.grantInvoke(stateMachineRole);
    bucket.grantRead(docParserLambda);    

    // DynamoDB Table
    const table = new dynamodb.Table(this, 'SurveyAppTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    table.grantWriteData(stateMachineRole);

    // Load statemachines/survey-processor.asl.json file contents from disk
    const surveyProcessorStateMachineDefinition = fs.readFileSync('statemachines/survey-processor.asl.json').toString();

    // Step function
    const cfnStateMachine = new sfn.CfnStateMachine(this, 'DocParserStateMachine', {
      definitionString: surveyProcessorStateMachineDefinition,
      definitionSubstitutions: {
        TableName: table.tableName,
        DocParserLambda: docParserLambda.functionArn
      },
      roleArn: stateMachineRole.roleArn
    });
  }
}
