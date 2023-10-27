import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

interface IIngestParams {
  readonly ingestQueue: cdk.aws_sqs.Queue;
}

export class IngestConstruct extends Construct {
  constructor(scope: Construct, id: string, params: IIngestParams) {
    super(scope, id);

    // S3 Bucket
    const bucket = new s3.Bucket(this, 'ingestBucket', {});

    const managedPolicy = new iam.ManagedPolicy(this, 'IngestUploadPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: ['s3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
          resources: [`${bucket.bucketArn}/*`, bucket.bucketArn],
        }),
      ],
    });

    //IAM User
    const user = new iam.User(this, 'IngestUser', {
      managedPolicies: [managedPolicy],
    });

    // Output the username
    new cdk.CfnOutput(this, 'IngestUserUsername', {
      value: user.userName,
    });

    new cdk.CfnOutput(this, 'IngestUserInstructions', {
      value: `Create an access key for the ingest user here: https://${
        cdk.Stack.of(this).region
      }.console.${cdk.Stack.of(this).partition}.amazon.com/iamv2/home?region=${
        cdk.Stack.of(this).region
      }#/users/details/${user.userName}?section=security_credentials`,
    });

    // Output Ingest Bucket Information
    new cdk.CfnOutput(this, 'IngestBucketEndpoint', {
      value: `s3.${cdk.Stack.of(this).region}.amazonaws.com`,
    });
    new cdk.CfnOutput(this, 'IngestBucketName', {
      value: bucket.bucketName,
    });

    // Load S3 bucket with example files
    // new s3deploy.BucketDeployment(this, 'DeployFiles', {
    //   sources: [s3deploy.Source.asset('assets/s3-files')],
    //   destinationBucket: bucket,
    // });

    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(params.ingestQueue),
    );
  }

  public getIngestBucket = (): s3.Bucket =>
    this.node.findChild('ingestBucket') as s3.Bucket;
}
