const { unmarshall } = require('@aws-sdk/util-dynamodb');

const getAverage = (items, attribute, count) => {
  return items.reduce((acc, item) => acc + item[attribute], 0) / count;
};

exports.handler = async (event, context) => {
  console.log({ event });
  const items = event.Items.map(unmarshall);
  console.log(JSON.stringify(items));

  return {
    foodQualityAvg: getAverage(items, 'FoodQuality', event.Count),
    topicsAvg: getAverage(items, 'Topics', event.Count),
    cabinAccessibilityAvg: getAverage(items, 'CabinAccessibility', event.Count),
    cabinCleanlinessAvg: getAverage(items, 'CabinCleanliness', event.Count),
    sessionLengthAvg: getAverage(items, 'SessionLength', event.Count),
    speakerChoiceAvg: getAverage(items, 'SpeakerChoice', event.Count),
    sentiment: {
      positiveAvg: getAverage(items, 'PositiveScore', event.Count),
      mixedAvg: getAverage(items, 'MixedScore', event.Count),
      neutralAvg: getAverage(items, 'NeutralScore', event.Count),
      negativeAvg: getAverage(items, 'NegativeScore', event.Count),
    },
  };
};
