import boto3
import json

# Pointing boto3 to LocalStack container
sqs = boto3.client(
    'sqs',
    endpoint_url='http://localhost:4566',
    region_name='us-west-2',
    aws_access_key_id='test',
    aws_secret_access_key='test'
)

queue_url = 'http://sqs.us-west-2.localhost.localstack.cloud:4566/000000000000/grants-ingest-events'

# Mock grant payload shaped to match what the real grants-ingest service sends:
# { detail: { type, versions: { new: {...}, previous: {...} } } }
# See packages/server/src/lib/grants-ingest.js -> mapSourceDataToGrant
grant_data = {
    "detail": {
        "type": "create",
        "versions": {
            "new": {
                "opportunity": {
                    "id": "123456",
                    "number": "TEST-GRANT-2026-PY",
                    "title": "Python Community Tech Grant",
                    "description": "A proof-of-concept grant sent to test the Grants.gov adapter pipeline.",
                    "category": {"code": "D", "name": "Discretionary"},
                    "milestones": {
                        "post_date": "2026-01-01",
                        "close": {"date": "2026-12-31"}
                    }
                },
                "agency": {
                    "code": "TECH-101",
                    "name": "Department of Technology Innovation"
                },
                "revision": {"id": "1"},
                "cost_sharing_or_matching_requirement": False,
                "cfda_numbers": ["99.999"],
                "eligible_applicants": [{"code": "00"}],
                "award": {"ceiling": "50000", "floor": "5000"}
            },
            "previous": {}
        }
    }
}

# sending it to the queue
response = sqs.send_message(
    QueueUrl=queue_url,
    MessageBody=json.dumps(grant_data)
)

print(f"Successfully sent test message! Message ID: {response['MessageId']}")
