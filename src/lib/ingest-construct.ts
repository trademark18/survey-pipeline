import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';

interface IIngestParams {
  readonly ingestQueue: cdk.aws_sqs.Queue;
}

export class IngestConstruct extends Construct {
  constructor(scope: Construct, id: string, params: IIngestParams) {
    super(scope, id);

    // S3 Bucket
    const bucket = new s3.Bucket(this, 'ingestBucket', {});

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
