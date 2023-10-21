const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { generateSurvey } = require('./generateSurvey');

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient());

const surveys = [
  generateSurvey(),
  generateSurvey(),
  generateSurvey(),
  generateSurvey(),
  generateSurvey(),
];

surveys.map((s) => {
  ddbDocClient.send(
    new PutCommand({
      TableName: 'DreedLectureAppStack-SurveyAppTableAD30E6A2-F5TZKCRHQIK5',
      Item: s,
    }),
  );
});
