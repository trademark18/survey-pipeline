const { DynamoDBClient, DeleteItemCommand } = require("@aws-sdk/client-dynamodb");

const db = new DynamoDBClient({});

exports.handler = async (event) => {
  console.log(event);

  const dbResult = await db.send(new DeleteItemCommand({
    TableName: process.env.TableName,
    Key: {
      connectionId: { S: event.requestContext.connectionId },
    }
  }));

  console.log(dbResult);

  const response = {
    statusCode: 200,
  };
  return response;
};
