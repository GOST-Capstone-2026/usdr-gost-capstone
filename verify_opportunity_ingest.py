"""
checks the grants-ingest pipeline end to end:
  1. codes get saved into the normalized tables
  2. sending the same event twice doesn't change anything (idempotent)
  3. a newer revision replaces the codes
  4. an older revision showing up late gets ignored

needs docker compose running and the consumer going in another terminal:
  docker exec -it gost-app sh -c "cd /app/packages/server && node src/scripts/consumeGrantModifications.js"
"""
import json
import subprocess
import sys
import time

import boto3

QUEUE_URL = 'http://sqs.us-west-2.localhost.localstack.cloud:4566/000000000000/grants-ingest-events'
GRANT_ID = 'PY-VERIFY-001'
CODE_TABLES = [
    'grants_cfda_numbers',
    'grants_eligibility_codes',
    'grants_funding_instrument_codes',
    'grants_funding_activity_category_codes',
]

sqs = boto3.client(
    'sqs',
    endpoint_url='http://localhost:4566',
    region_name='us-west-2',
    aws_access_key_id='test',
    aws_secret_access_key='test',
)

failures = 0


def make_event(revision, cfda_numbers, eligibility, instruments, title):
    # same shape grants-ingest sends, see test_grant.py
    return {
        'detail': {
            'type': 'update',
            'versions': {
                'new': {
                    'opportunity': {
                        'id': GRANT_ID,
                        'number': 'PY-VERIFY-2026',
                        'title': title,
                        'description': 'grant used by verify_opportunity_ingest.py',
                        'category': {'code': 'D', 'name': 'Discretionary'},
                        'milestones': {'post_date': '2026-01-01', 'close': {'date': '2026-12-31'}},
                    },
                    'agency': {'code': 'TECH-101', 'name': 'Department of Technology Innovation'},
                    'revision': {'id': revision},
                    'cost_sharing_or_matching_requirement': False,
                    'cfda_numbers': cfda_numbers,
                    'eligible_applicants': [{'code': c} for c in eligibility],
                    'funding_instrument_types': [{'code': c} for c in instruments],
                    'funding_activity': {'categories': [{'code': 'ST', 'name': 'Science and Technology'}]},
                    'award': {'ceiling': '50000', 'floor': '5000'},
                },
                'previous': {},
            },
        },
    }


def send(event):
    sqs.send_message(QueueUrl=QUEUE_URL, MessageBody=json.dumps(event))


def psql(sql):
    out = subprocess.run(
        ['docker', 'exec', 'gost-postgres', 'psql', '-U', 'postgres', '-d', 'usdr_grants', '-tAc', sql],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def snapshot():
    # grabs the grant row + every code so we can compare before/after
    grant = psql(f"SELECT revision_id || ' | ' || title FROM grants WHERE grant_id = '{GRANT_ID}'")
    codes = {t: sorted(filter(None, psql(f"SELECT code FROM {t} WHERE grant_id = '{GRANT_ID}'").split('\n')))
             for t in CODE_TABLES}
    return grant, codes


def wait_for_queue_to_drain(timeout=60):
    # the consumer deletes messages after it handles them, so empty queue = done
    start = time.time()
    while time.time() - start < timeout:
        attrs = sqs.get_queue_attributes(
            QueueUrl=QUEUE_URL,
            AttributeNames=['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
        )['Attributes']
        if attrs['ApproximateNumberOfMessages'] == '0' and attrs['ApproximateNumberOfMessagesNotVisible'] == '0':
            time.sleep(1)
            return
        time.sleep(2)
    sys.exit('queue never drained, is the consumer running?')


def check(label, actual, expected):
    global failures
    ok = actual == expected
    failures += 0 if ok else 1
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
    if not ok:
        print(f'         expected: {expected}\n         actual:   {actual}')


def print_snapshot(grant, codes):
    print(f'  grants row: {grant}')
    for table, values in codes.items():
        print(f'  {table}: {values}')


# starts clean so reruns work
psql(f"DELETE FROM grants WHERE grant_id = '{GRANT_ID}'")

print('\nstep 1: send revision r1 (cfda list has a duplicate + blank on purpose)')
send(make_event('r1', ['11.111', '11.111', ' ', '22.222'], ['00', '01'], ['G'], 'verify grant v1'))
wait_for_queue_to_drain()
grant, codes = snapshot()
print_snapshot(grant, codes)
check('grant saved at r1', grant, 'r1 | verify grant v1')
check('cfda codes normalized + deduped', codes['grants_cfda_numbers'], ['11.111', '22.222'])
check('eligibility codes saved', codes['grants_eligibility_codes'], ['00', '01'])
check('funding instrument codes saved', codes['grants_funding_instrument_codes'], ['G'])
check('activity category codes saved', codes['grants_funding_activity_category_codes'], ['ST'])

print('\nstep 2: send the exact same r1 event twice (like an sqs redelivery)')
before = snapshot()
send(make_event('r1', ['11.111', '11.111', ' ', '22.222'], ['00', '01'], ['G'], 'verify grant v1'))
send(make_event('r1', ['11.111', '11.111', ' ', '22.222'], ['00', '01'], ['G'], 'verify grant v1'))
wait_for_queue_to_drain()
check('nothing changed after duplicates', snapshot(), before)

print('\nstep 3: send newer revision r2 with different codes')
send(make_event('r2', ['33.333'], ['25'], ['CA', 'G'], 'verify grant v2'))
wait_for_queue_to_drain()
grant, codes = snapshot()
print_snapshot(grant, codes)
check('grant updated to r2', grant, 'r2 | verify grant v2')
check('old cfda codes replaced', codes['grants_cfda_numbers'], ['33.333'])
check('eligibility codes replaced', codes['grants_eligibility_codes'], ['25'])
check('funding instrument codes replaced', codes['grants_funding_instrument_codes'], ['CA', 'G'])

print('\nstep 4: send old revision r1 again (out of order, should be ignored)')
before = snapshot()
send(make_event('r1', ['11.111'], ['00'], ['G'], 'verify grant v1'))
wait_for_queue_to_drain()
check('stale revision ignored', snapshot(), before)

print(f"\n{'all checks passed' if failures == 0 else f'{failures} check(s) failed'}")
sys.exit(1 if failures else 0)
