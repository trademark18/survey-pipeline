const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

const db = new DynamoDBClient({});

export const handler = async (event) => {
  console.log(event);

  const dbResult = await db.send(new DeleteItemCommand({
    TableName: process.env.TableName,
    Item: {
      connectionId: { S: event.requestContext.connectionId },
    }
  }));

  console.log(dbResult);

  const response = {
    statusCode: 200,
  };
  return response;
};
