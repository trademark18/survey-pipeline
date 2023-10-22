#!/bin/bash

echo Using AWS profile "$1"

# Deploy the app using CDK
cdk deploy --profile $1

# Retrieve the output value from the deployed stack
output_value=$(aws cloudformation describe-stacks --profile $1 --stack-name SurveyAppStack --query "Stacks[0].Outputs[?ExportName=='WebsocketURL'].OutputValue" --output text)
bucket_name=$(aws cloudformation describe-stacks --profile $1 --stack-name SurveyAppStack --query "Stacks[0].Outputs[?ExportName=='BucketName'].OutputValue" --output text)

# Write a json file called config.json
echo "{\"websocketURL\": \"$output_value\"}" > dist/config.json

# Upload a config.json file to the S3 bucket
aws s3 cp dist/config.json s3://$bucket_name/config.json --profile $1
