const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { generateSurvey } = require('./generateSurvey');

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient());

const TableName =
  'SurveyAppStack-ParsingPipelineConstructSurveyAppTable6C94B256-801X0R61KCX1';

const surveys = [
  generateSurvey(),
  generateSurvey(),
  generateSurvey(),
  generateSurvey(),
  generateSurvey(),
];

surveys.map((Item) => {
  ddbDocClient.send(new PutCommand({ TableName, Item }));
});
