import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';

export class IngestConstruct extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // S3 Bucket
    const bucket = new s3.Bucket(this, 'ingestBucket', {});

    // Load S3 bucket with files
    new s3deploy.BucketDeployment(this, 'DeployFiles', {
      sources: [s3deploy.Source.asset('assets/s3-files')],
      destinationBucket: bucket,
    });
  }

  public getIngestBucket = (): s3.Bucket =>
    this.node.findChild('ingestBucket') as s3.Bucket;
}
