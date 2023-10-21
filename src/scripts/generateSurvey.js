const { faker } = require('@faker-js/faker');

const generateSurvey = () => {
  return {
    pk: 'Survey',
    sk: faker.date.recent().getTime().toString(),
    CabinAccessibility: faker.number.int({ min: 1, max: 5 }),
    CabinCleanliness: faker.number.int({ min: 1, max: 5 }),
    Email: faker.internet.email(),
    FoodQuality: faker.number.int({ min: 1, max: 5 }),
    HighlightComment: faker.lorem.sentence(),
    MixedScore: faker.number.float(),
    Name: faker.person.fullName(),
    NegativeScore: faker.number.float(),
    NeutralScore: faker.number.float(),
    OverallComment: faker.lorem.sentence(),
    PositiveScore: faker.number.float(),
    Sentiment: faker.helpers.arrayElement([
      'POSITIVE',
      'NEGATIVE',
      'NEUTRAL',
      'MIXED',
    ]),
    SessionLength: faker.number.int({ min: 1, max: 5 }),
    SpeakerChoice: faker.number.int({ min: 1, max: 5 }),
    Topics: faker.number.int({ min: 1, max: 5 }),
  };
};

module.exports = { generateSurvey };
