import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';
import { IngestConstruct } from './ingest-construct';
import { ParsingPipelineConstruct } from './parsing-pipeline-construct';
import { WssConstruct } from './wss-construct';
import { StatsSiteConstruct } from './stats-site-construct';

export class SurveyAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Event bus (shared across several constructs)
    const eventBus = new events.EventBus(this, 'SurveyAppEventBus', {});

    // Ingest construct
    const ingestConstruct = new IngestConstruct(this, 'IngestConstruct');
    const ingestBucket = ingestConstruct.getIngestBucket();

    // Parsing pipeine construct
    new ParsingPipelineConstruct(this, 'ParsingPipelineConstruct', {
      sourceBucket: ingestBucket,
      eventBus,
    });

    // Websockets construct
    new WssConstruct(this, 'WssConstruct', {
      eventBus,
    });

    // Stats static site construct
    new StatsSiteConstruct(this, 'StatsSiteConstruct', {
      eventBus,
    });
  }
}
