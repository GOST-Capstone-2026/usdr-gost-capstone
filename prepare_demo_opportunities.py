"""
builds the first-demo opportunity set (task A-09).

pulls real, currently posted opportunities from the public grants.gov api,
keeps a small curated mix that state/local governments can actually apply for,
and saves them in the same shape grants-ingest events use, so the loader can
push them through the normal ingest code.

  python prepare_demo_opportunities.py            # fetch + write the json file
  python prepare_demo_opportunities.py --check    # just validate the existing file

no api key needed, stdlib only. output: packages/server/seeds/demo/opportunities.json
"""
import html
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

API = 'https://api.grants.gov/v1/api'
OUT_FILE = Path(__file__).parent / 'packages' / 'server' / 'seeds' / 'demo' / 'opportunities.json'

# what the demo audience (state + local gov) cares about, mapped to grants.gov
# funding category codes. keyword search was too fuzzy, categories are exact.
# some categories only have a couple open grants at a time, so the list is wider than we need
TOPICS = {
    'transportation': 'T',
    'public safety': 'LJL',
    'housing': 'HO',
    'workforce': 'ELT',
    'community dev': 'CD',
    'environment': 'ENV',
    'disaster relief': 'DPR',
    'health': 'HL',
    'energy': 'EN',
    'education': 'ED',
}
PER_TOPIC = 2
TARGET_COUNT = 12
MIN_COUNT = 10
MIN_TOPICS = 5
# state, county, city/township governments
ELIGIBILITY = '00|01|02'
# research-center grants aimed at universities, not useful for a gov demo
EXCLUDED_AGENCY_PREFIXES = ('HHS-NIH',)
MIN_DESCRIPTION_CHARS = 300
MIN_DAYS_UNTIL_CLOSE = 30
REQUIRED_FIELDS = ['id', 'number', 'title', 'description']


def post(path, body):
    req = urllib.request.Request(
        f'{API}/{path}',
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        payload = json.load(res)
    if payload.get('errorcode') != 0:
        sys.exit(f"grants.gov {path} failed: {payload.get('msg')}")
    return payload['data']


def to_iso(value):
    # grants.gov sends dates like "Mar 14, 2023 12:00:00 AM EDT"
    if not value:
        return None
    match = re.match(r'([A-Za-z]{3} \d{1,2}, \d{4})', value)
    return datetime.strptime(match.group(1), '%b %d, %Y').date().isoformat() if match else None


def plain_text(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', value or ''))).strip()


def codes(items):
    return [{'code': it['id'], 'name': it.get('description')} for it in (items or [])]


def to_ingest_shape(detail, topic, revision_id):
    # maps a grants.gov fetchOpportunity response to the grants-ingest "versions.new" shape.
    # see mapSourceDataToGrant in packages/server/src/lib/grants-ingest.js
    syn = detail.get('synopsis') or {}
    category = detail.get('opportunityCategory') or {}
    agency = detail.get('agencyDetails') or {}
    close_date = to_iso(syn.get('responseDate'))
    close = {'date': close_date} if close_date else {}
    if syn.get('responseDateDesc'):
        close['explanation'] = plain_text(syn['responseDateDesc'])[:250]
    milestones = {'post_date': to_iso(syn.get('postingDate')), 'close': close}
    if to_iso(syn.get('archiveDate')):
        milestones['archive_date'] = to_iso(syn.get('archiveDate'))

    award = {}
    for ours, theirs in [('ceiling', 'awardCeiling'), ('floor', 'awardFloor'),
                         ('estimated_total_program_funding', 'estimatedFunding'),
                         ('expected_number_of_awards', 'numberOfAwards')]:
        if str(syn.get(theirs) or '').isdigit():
            award[ours] = syn[theirs]

    return {
        'demo': {'topic': topic, 'source_url': f"https://www.grants.gov/search-results-detail/{detail['id']}"},
        'opportunity': {
            'id': str(detail['id']),
            'number': detail.get('opportunityNumber'),
            'title': plain_text(detail.get('opportunityTitle')),
            'description': syn.get('synopsisDesc') or '',
            'category': {'code': category.get('category'), 'name': category.get('description')},
            'milestones': milestones,
        },
        'agency': {'code': detail.get('owningAgencyCode'), 'name': agency.get('agencyName')},
        'revision': {'id': revision_id},
        'cost_sharing_or_matching_requirement': str(syn.get('costSharing')).lower() == 'true',
        'cfda_numbers': [c['cfdaNumber'] for c in detail.get('cfdas') or [] if c.get('cfdaNumber')],
        'eligible_applicants': codes(syn.get('applicantTypes')),
        'funding_instrument_types': codes(syn.get('fundingInstruments')),
        'funding_activity': {'categories': codes(syn.get('fundingActivityCategories'))},
        'award': award,
        'grantor': {
            'name': plain_text(syn.get('agencyContactName'))[:250] or None,
            'phone': (syn.get('agencyContactPhone') or '')[:250] or None,
        },
    }


def problems_with(opp, today):
    # returns why an opportunity isn't demo-ready. empty list = good
    found = []
    core = opp['opportunity']
    found += [f'missing {f}' for f in REQUIRED_FIELDS if not core.get(f)]
    if len(plain_text(core.get('description'))) < MIN_DESCRIPTION_CHARS:
        found.append('description too short')
    # requests for information get posted like grants but there's no money to apply for
    if re.match(r'(rfi|request for information|notice of intent)\b', core.get('title') or '', re.I):
        found.append('not a funding opportunity')
    if not core['milestones'].get('post_date'):
        found.append('no post date')
    close_date = core['milestones']['close'].get('date')
    if close_date and date.fromisoformat(close_date) < today + timedelta(days=MIN_DAYS_UNTIL_CLOSE):
        found.append(f'closes too soon ({close_date})')
    if not opp['cfda_numbers']:
        found.append('no assistance listing (cfda) number')
    if not {'00', '01', '02'} & {e['code'] for e in opp['eligible_applicants']}:
        found.append('state/local governments not eligible')
    if not opp['agency'].get('code'):
        found.append('no agency code')
    elif opp['agency']['code'].startswith(EXCLUDED_AGENCY_PREFIXES):
        found.append('excluded agency')
    return found


def fetch():
    today = date.today()
    revision_id = f'demo-{today:%Y%m%d}'
    picked = {}
    for topic, category in TOPICS.items():
        if len(picked) >= TARGET_COUNT:
            break
        hits = post('search2', {
            'fundingCategories': category, 'oppStatuses': 'posted', 'eligibilities': ELIGIBILITY, 'rows': 100,
        })['oppHits']
        kept = 0
        for hit in hits:
            if kept == PER_TOPIC or len(picked) >= TARGET_COUNT:
                break
            # cheap skips first so we don't fetch details we'd throw away
            if hit['id'] in picked or hit['agencyCode'].startswith(EXCLUDED_AGENCY_PREFIXES):
                continue
            opp = to_ingest_shape(post('fetchOpportunity', {'opportunityId': int(hit['id'])}), topic, revision_id)
            if problems_with(opp, today):
                continue
            picked[hit['id']] = opp
            kept += 1
        print(f'  {topic}: kept {kept} of {len(hits)} search hits')

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps({
        'source': 'grants.gov public api (search2 + fetchOpportunity)',
        'fetched_on': today.isoformat(),
        'opportunities': list(picked.values()),
    }, indent=2) + '\n', encoding='utf-8')
    print(f'wrote {len(picked)} opportunities to {OUT_FILE.relative_to(Path(__file__).parent)}')


def check():
    # quality report on the saved file. this is the "is the demo data ready" proof
    data = json.loads(OUT_FILE.read_text(encoding='utf-8'))
    opps = data['opportunities']
    today = date.today()
    print(f"\ndemo opportunity set: {len(opps)} opportunities, fetched {data['fetched_on']} from {data['source']}\n")
    print(f"{'id':<8}{'topic':<16}{'agency':<14}{'closes':<12}{'ceiling':>14}  title")
    failures = 0
    for opp in opps:
        core = opp['opportunity']
        issues = problems_with(opp, today)
        failures += 1 if issues else 0
        ceiling = f"${int(opp['award']['ceiling']):,}" if opp['award'].get('ceiling') else '-'
        print(f"{core['id']:<8}{opp['demo']['topic']:<16}{opp['agency']['code'][:13]:<14}"
              f"{core['milestones']['close'].get('date', 'rolling'):<12}{ceiling:>14}  {core['title'][:60]}")
        for issue in issues:
            print(f'         [FAIL] {issue}')

    ids = [o['opportunity']['id'] for o in opps]
    checks = [
        (f'at least {MIN_COUNT} opportunities', len(opps) >= MIN_COUNT),
        ('no duplicate ids', len(ids) == len(set(ids))),
        ('every opportunity passes the quality rules', failures == 0),
        (f'at least {MIN_TOPICS} different topics', len({o['demo']['topic'] for o in opps}) >= MIN_TOPICS),
    ]
    print()
    for label, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
    all_ok = all(ok for _, ok in checks)
    print(f"\n{'demo data is ready' if all_ok else 'demo data needs attention'}")
    sys.exit(0 if all_ok else 1)


if __name__ == '__main__':
    if '--check' not in sys.argv:
        fetch()
    check()
