const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");

const ddb = new DynamoDBClient({});

exports.handler = async (event, context) => {

  const data = await ddb.send(new ScanCommand({
    TableName: process.env.SurveyTableName,
  }));

  const foodSum = data.Items.reduce((acc, item) => {
    return acc + Number(item.FoodQuality.N);
  }, 0);

  const foodAvg = foodSum / data.Items.length;

  return { foodAvg: foodAvg };
};
