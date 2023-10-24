import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as fs from 'fs';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha';

export interface IWssParams {
  readonly eventBus: cdk.aws_events.EventBus;
}

export class WssConstruct extends Construct {
  constructor(scope: Construct, id: string, params: IWssParams) {
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

    const updateSiteSfnRole = new iam.Role(this, 'UpdateSiteStateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      managedPolicies: [xraySfnPolicy],
    });

    const connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    connectionsTable.grantReadData(updateSiteSfnRole);
    updateSiteSfnRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Scan'],
        resources: [connectionsTable.tableArn],
      }),
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
        EventBusName: params.eventBus.eventBusName,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    params.eventBus.grantPutEventsTo(connectHandler);

    // $disconnect handler Lambda
    const disconnectHandler = new lambda.Function(this, 'DisconnectHandler', {
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/disconnect-handler'),
      environment: {
        TableName: connectionsTable.tableName,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    connectionsTable.grantWriteData(connectHandler);
    connectionsTable.grantWriteData(disconnectHandler);

    // API Gateway WSS API
    const webSocketApi = new apigwv2.WebSocketApi(
      this,
      'SurveyAppWebSocketApi',
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

    new cdk.CfnOutput(this, 'WebsocketURL', {
      value: `wss://${webSocketApi.apiId}.execute-api.${
        cdk.Stack.of(this).region
      }.amazonaws.com/${wssStage.stageName}`,
      exportName: 'WebsocketURL',
    });

    const wssApiEndpoint = `${webSocketApi.apiId}.execute-api.${
      cdk.Stack.of(this).region
    }.amazonaws.com`;
    webSocketApi.grantManageConnections(updateSiteSfnRole);

    // Update Site Step function
    const cfnUpdateSiteStateMachine = new sfn.CfnStateMachine(
      this,
      'UpdateSiteStateMachine',
      {
        definitionString: updateSiteStateMachineDefinition,
        definitionSubstitutions: {
          TableName: connectionsTable.tableName,
          WssEndpoint: wssApiEndpoint,
          WssStageName: wssStage.stageName,
        },
        roleArn: updateSiteSfnRole.roleArn,
        tracingConfiguration: {
          enabled: true,
        },
      },
    );

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
      eventBusName: params.eventBus.eventBusName,
      eventPattern: {
        source: ['survey-app'],
        'detail-type': ['stats-updated'],
      },
      targets: [
        {
          arn: cfnUpdateSiteStateMachine.attrArn,
          id: 'UpdateSite',
          roleArn: updateSiteTriggerRole.roleArn,
        },
      ],
    });
  }
}
