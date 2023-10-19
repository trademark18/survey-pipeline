const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");

const db = new DynamoDBClient({});
const eventBridgeClient = new EventBridgeClient({});

export const handler = async (event) => {
  console.log(event);

  // 
  const dbResult = await db.send(new PutItemCommand({
    TableName: process.env.TableName,
    Item: {
      connectionId: { S: event.requestContext.connectionId },
    }
  }));

  console.log(dbResult);

  // Send a message to the EventBridge bus
  const eventBridgeResult = await eventBridgeClient.send(new PutEventsCommand({
    Entries: [
      {
        EventBusName: process.env.EventBusName,
        Source: "survey-app",
        DetailType: "result-generated",
        Detail: JSON.stringify({ message: "New results are ready.  Recalculate stats." }),
      },
    ],
  }));

  console.log(eventBridgeResult);

  const response = {
    statusCode: 200,
  };
  return response;
};
