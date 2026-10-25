"""
reviewing the matching evaluation labels (task A-11).

walks through every draft case in packages/server/evaluation/matching-fixtures.json,
shows the grant facts next to the drafted label, and lets you accept or fix it.
each answer is saved right away, so you can quit and pick up where you left off.

  python review_matching_fixtures.py                 # reviewing draft cases
  python review_matching_fixtures.py --status        # just printing progress
  python review_matching_fixtures.py --redo <case>   # reopening one case, e.g. main/fl-city-flood/364009

stdlib only, no api calls.
"""
import json
import sys
import textwrap
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent
FIXTURES = ROOT / 'packages' / 'server' / 'evaluation' / 'matching-fixtures.json'
GRANTS = ROOT / 'packages' / 'server' / 'seeds' / 'demo' / 'opportunities.json'

DISPOSITIONS = ['eligible', 'reviewRequired', 'blocked']
BLOCKERS = ['APPLICANT_TYPE_UNSUPPORTED', 'DEADLINE_PASSED', 'MATCHING_FUNDS_INSUFFICIENT',
            'MATCHING_FUNDS_UNAVAILABLE', 'OPPORTUNITY_CLOSED']
NOT_MODELED = ['GEOGRAPHY', 'APPLICANT_TYPE_IN_NOTICE_TEXT']


def load():
    return json.loads(FIXTURES.read_text(encoding='utf8'))


def save(doc):
    # writing to a temp file first so a crash mid-save can't wipe the fixtures
    tmp = FIXTURES.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(doc, indent=2) + '\n', encoding='utf8', newline='\n')
    tmp.replace(FIXTURES)


def print_status(doc):
    cases = doc['cases']
    done = [c for c in cases if c['review']['status'] == 'reviewed']
    changed = [c for c in done if c['review']['changed']]
    print(f'{len(done)} of {len(cases)} reviewed, {len(changed)} changed in review')
    for scenario in doc['scenarios']:
        sub = [c for c in cases if c['scenario'] == scenario['id']]
        n = sum(c['review']['status'] == 'reviewed' for c in sub)
        print(f'  {scenario["id"]:<22} {n}/{len(sub)}')


def show(case, doc, grants, index, total):
    g = grants[case['grantId']]
    op = g['opportunity']
    profile = doc['profiles'][case['profile']]
    scenario = next(s for s in doc['scenarios'] if s['id'] == case['scenario'])
    funds = profile['matchingFunds']
    exp = case['expected']
    wrap = lambda text: textwrap.fill(text, 100, initial_indent='    ', subsequent_indent='    ')

    print('\n' + '=' * 100)
    print(f'[{index}/{total}] {case["id"]}    screening date {scenario["asOfDate"]}')
    print(f'\nprofile  {profile["jurisdiction"]["type"]} in {profile["jurisdiction"]["stateCode"]}, '
          f'focus: {", ".join(profile["focusAreas"])}')
    print(f'         matching funds available: {funds["available"]}, max cents: {funds["maximumAmountCents"]}')
    print(f'\ngrant    {op["title"]}')
    print(f'         {g["demo"]["source_url"]}')
    print(f'         applicant codes: {" ".join(e["code"] for e in g.get("eligible_applicants", []))}')
    print(f'         cost share required: {g.get("cost_sharing_or_matching_requirement")}')
    m = op['milestones']
    print(f'         posted {m.get("post_date")}, closes {(m.get("close") or {}).get("date")}, archives {m.get("archive_date")}')
    print(wrap(' '.join(op['description'].split())[:700]))
    print(f'\ndraft    disposition: {exp["disposition"]}')
    print(f'         blockers:    {", ".join(exp["blockers"]) or "none"}')
    if 'relevance' in exp:
        print(f'         relevance:   {exp["relevance"]}  (0 not relevant, 1 partly, 2 directly)')
    print(f'         not modeled: {", ".join(exp["notModeled"]) or "none"}')
    print(f'         why: {case["rationale"]}')


def ask_choice(prompt, options, current):
    while True:
        raw = input(f'  {prompt} [{"/".join(options)}] (enter keeps {current}): ').strip()
        if not raw:
            return current
        if raw in options:
            return raw
        print('  not one of the options, try again')


def ask_codes(prompt, options, current):
    print(f'  {prompt}: ' + ', '.join(f'{i}={code}' for i, code in enumerate(options, 1)))
    while True:
        raw = input(f'  numbers separated by spaces, "-" for none (enter keeps {current or "none"}): ').strip()
        if not raw:
            return current
        if raw == '-':
            return []
        try:
            picked = sorted({options[int(n) - 1] for n in raw.split()})
            return picked
        except (ValueError, IndexError):
            print('  use numbers from the list')


def edit(case):
    exp = dict(case['expected'])
    exp['disposition'] = ask_choice('disposition', DISPOSITIONS, exp['disposition'])
    if exp['disposition'] == 'blocked':
        exp['blockers'] = ask_codes('blockers', BLOCKERS, exp['blockers'])
        while not exp['blockers']:
            print('  blocked needs at least one blocker code')
            exp['blockers'] = ask_codes('blockers', BLOCKERS, exp['blockers'])
    else:
        exp['blockers'] = []
    if 'relevance' in exp:
        exp['relevance'] = int(ask_choice('relevance', ['0', '1', '2'], str(exp['relevance'])))
    exp['notModeled'] = ask_codes('not modeled', NOT_MODELED, exp['notModeled'])
    return exp


def main(args):
    doc = load()
    if '--status' in args:
        print_status(doc)
        return
    grants = {o['opportunity']['id']: o for o in json.loads(GRANTS.read_text(encoding='utf8'))['opportunities']}

    if '--redo' in args:
        target = args[args.index('--redo') + 1] if len(args) > args.index('--redo') + 1 else None
        hit = [c for c in doc['cases'] if c['id'] == target]
        if not hit:
            print(f'no case called {target}')
            return
        hit[0]['review']['status'] = 'draft'
        save(doc)

    reviewer = input('your name for the review record: ').strip()
    if not reviewer:
        print('a name is needed so the review can be traced')
        return

    todo = [c for c in doc['cases'] if c['review']['status'] != 'reviewed']
    print(f'{len(todo)} cases left. enter = label is right, e = edit, s = skip for now, q = quit')
    for i, case in enumerate(todo, 1):
        show(case, doc, grants, i, len(todo))
        while True:
            answer = input('\n  label right? [enter/e/s/q]: ').strip().lower()
            if answer in ('', 'e', 's', 'q'):
                break
        if answer == 'q':
            break
        if answer == 's':
            continue
        changed = False
        if answer == 'e':
            new = edit(case)
            changed = new != case['expected']
            case['expected'] = new
        note = input('  note (optional, enter to skip): ').strip() or None
        case['review'] = {
            'status': 'reviewed',
            'reviewer': reviewer,
            'reviewedOn': date.today().isoformat(),
            'changed': changed or case['review'].get('changed', False),
            'notes': note,
        }
        # saving after every case so quitting never loses work
        save(doc)
    print()
    print_status(doc)


if __name__ == '__main__':
    main(sys.argv[1:])
