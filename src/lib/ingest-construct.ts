import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';

interface IIngestParams {
  readonly ingestQueue: cdk.aws_sqs.Queue;
}

export class IngestConstruct extends Construct {
  constructor(scope: Construct, id: string, params: IIngestParams) {
    super(scope, id);

    // S3 Bucket
    const bucket = new s3.Bucket(this, 'ingestBucket', {});

    //IAM User
    const user = new iam.User(this, 'IngestUser');
    const accessKey = new iam.AccessKey(this, 'AccessKey', { user });

    const policy = new iam.Policy(this, 'IngestUploadPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: ['s3:PutObject'],
          resources: [`${bucket.bucketArn}/*`],
        }),
      ],
    });

    user.attachInlinePolicy(policy);



    // Output the Access Key ID and Secret Access Key
    new cdk.CfnOutput(this, 'AccessKeyIdOutput', {
      value: accessKey.accessKeyId,
    });
    new cdk.CfnOutput(this, 'SecretAccessKeyOutput', {
      value: accessKey.secretAccessKey.unsafeUnwrap(),
    });

    // Output Ingest Bucket Information
    new cdk.CfnOutput(this, 'IngestBucketEndpoint', {
      value: bucket.bucketDomainName
    })
    new cdk.CfnOutput(this, 'IngestBucketName', {
      value: bucket.bucketName
    })

    

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
