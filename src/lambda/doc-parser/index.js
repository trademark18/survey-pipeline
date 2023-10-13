const { TextractClient, AnalyzeDocumentCommand } = require("@aws-sdk/client-textract");
const { TextractDocument } = require('amazon-textract-response-parser');

const textract = new TextractClient();

exports.handler = async (event) => {
  try {
    const textractResponse = await textract.send(new AnalyzeDocumentCommand({
      Document: {
        S3Object: {
          Bucket: process.env.BUCKET_NAME,
          Name: process.env.key
        }
      },
      FeatureTypes: ["FORMS"]
    }));

    const textractDocument = new TextractDocument(textractResponse);

    const getFormValue = (key) => {
      return textractDocument.form.getFieldByKey(key)?.value?.text;
    }

    const getIntValue = (key) => {
      const rawVal = getFormValue(key);
      try {
        return parseInt(rawVal);
      } catch (error) {
        console.error(error);
        console.error(`Could not parse integer from input ${rawVal}`);
        return undefined;
      }
    }

    // Use this to print out the detected fields and their values
    // for (const field of textractDocument.form.iterFields()) {
    //   console.log(`${field?.key.text}: ${field?.value?.text}`);
    // }

    const result = {
      Name: getFormValue('Name:'),
      Email: getFormValue('Email:'),
      FoodQuality: getFormValue('Food quality'),
      CabinAccessibility: getFormValue('Cabin accessibility'),
      Topics: getFormValue('Speaker\'s topics'),
      SessionLength: getFormValue('Session length'),
      CabinCleanliness: getFormValue('Cabin cleanliness'),
      SpeakerChoice: getFormValue('Speaker choice'),
      OverallComment: getFormValue('How would you describe your overall experience?'),
      HighlightComment: getFormValue('What is something you think will stick with you from the sessions?'),
      metadata: {
        timestamp: `${Date.now()}`,
      }
    };

    console.log(result); // Updated code!
  
    return result;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

