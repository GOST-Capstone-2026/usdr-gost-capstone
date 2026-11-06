import {
  describe, it, expect, afterEach,
} from 'vitest';
import { mount } from '@vue/test-utils';
import RankedMatchResults from '@/components/RankedMatchResults.vue';
import { makeMatchRun, matchContext } from '@/test-utils/matchRunFixture';

let wrapper;
afterEach(() => { wrapper?.unmount(); });

function render(props = {}) {
  wrapper = mount(RankedMatchResults, {
    props: {
      state: 'ready', run: makeMatchRun(), context: { ...matchContext }, ...props,
    },
  });
  return wrapper;
}

describe('C-11 ranked results interface', () => {
  it('shows all candidates with unchanged ranks, close-score precision, and interpretation limits', () => {
    render();
    expect(wrapper.findAll('article')).toHaveLength(5);
    expect(wrapper.findAll('article').map((item) => item.attributes('data-grant-id'))).toEqual(['1', '2', '3', '4', '5']);
    expect(wrapper.text()).toContain('0.295913');
    expect(wrapper.text()).toContain('0.293755');
    expect(wrapper.text()).toContain('0.000000');
    expect(wrapper.text()).toContain('Relevance is not eligibility, confidence, or funding probability');
    expect(wrapper.text()).toContain('Close scores may change with wording');
    expect(wrapper.text()).not.toContain('29.59%');
    expect(wrapper.text()).not.toContain('Strong fit');
  });

  it('keeps all hard blockers and warnings outside collapsed explanations', () => {
    render();
    const blocked = wrapper.get('[data-grant-id="4"]');
    const closedDetails = blocked.get('details');
    expect(blocked.text()).toContain('Blocked — not ranked');
    expect(blocked.text()).toContain('OPPORTUNITY_CLOSED');
    expect(blocked.text()).toContain('MATCHING_FUNDS_UNAVAILABLE');
    expect(blocked.text()).toContain('Review the geographic restrictions as well');
    expect(blocked.find('.match-results__eyebrow').text()).toContain('Unranked');
    expect(closedDetails.attributes('open')).toBeUndefined();
    expect(blocked.find('ul').element.closest('details')).toBeNull();
  });

  it('labels every explanation unverified, and never describes a screen pass as certified eligibility', () => {
    render();
    expect(wrapper.text().match(/Explanation: unverified/g)).toHaveLength(5);
    expect(wrapper.text()).toContain('No hard blocker found');
    expect(wrapper.text()).toContain('Listing-field excerpts are not verified PDF/page citations');
    expect(wrapper.text()).toContain('not LLM-generated prose');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('links claims only to local evidence anchors, all of which exist', () => {
    render();
    const anchors = wrapper.findAll('a');
    expect(anchors.length).toBeGreaterThan(0);
    anchors.forEach((anchor) => {
      const target = anchor.attributes('href');
      expect(target).toMatch(/^#match-results-\d+-grant-\d+-evidence-\d+$/);
      expect(wrapper.find(target).exists()).toBe(true);
    });
  });

  it('renders source text, explanations, warnings, limitations and claim references as inert text', () => {
    const run = makeMatchRun();
    const payload = '<img src=x onerror="alert(1)"><script>fetch("https://evil.test")</script>';
    const item = run.results[0];
    item.explanation = payload;
    item.explanationDetails.claims[0].text = payload;
    item.explanationDetails.limitations.push(payload);
    const evidence = item.explanationDetails.evidence[3];
    evidence.excerpt = payload;
    evidence.endOffset = payload.length;
    evidence.id = ['javascript', 'alert(1)'].join(':');
    item.explanationDetails.claims[0].evidenceIds = [evidence.id];
    render({ run });
    expect(wrapper.text()).toContain(payload);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('[onerror]').exists()).toBe(false);
    expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false);
  });

  it('shows provenance, actual method/model identities, hashes and field-offset metadata', () => {
    render();
    expect(wrapper.text()).toContain('Profile 1, version 2');
    expect(wrapper.text()).toContain('2026-10-25');
    expect(wrapper.text()).toContain('matcher-minilm-v2');
    expect(wrapper.text()).toContain('synthetic-display-test-model');
    expect(wrapper.text()).toContain('a'.repeat(64));
    expect(wrapper.text()).toContain('b'.repeat(64));
    expect(wrapper.text()).toContain('Normalized UTF-16 offsets');
    expect(wrapper.text()).toContain('end exclusive');
  });

  it('shows explicit missing revision and partial-title labels', () => {
    const run = makeMatchRun();
    const row = run.results[0];
    row.sourceRevision = null;
    row.explanationDetails.provenance.sourceRevision = null;
    row.explanationDetails.evidence[3].sourceRevision = null;
    row.explanationDetails.evidence[3].truncated = true;
    render({ run });
    expect(wrapper.text()).toContain('(partial title)');
    expect(wrapper.text()).toContain('Revision: Unavailable');
    expect(wrapper.text()).toContain('Partial excerpt');
    expect(wrapper.text()).not.toContain('Revision: undefined');
  });

  it.each(['idle', 'loading', 'error'])('hides previous results while state is %s', (state) => {
    render({ state });
    expect(wrapper.findAll('article')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('Synthetic flood program');
    expect(wrapper.text()).not.toContain('a'.repeat(64));
    if (state === 'loading') expect(wrapper.attributes('aria-busy')).toBe('true');
  });

  it('hides ready results immediately when the selected organization changes', async () => {
    render();
    await wrapper.setProps({ context: { ...matchContext, organizationId: 4 } });
    expect(wrapper.findAll('article')).toHaveLength(0);
    expect(wrapper.get('[role="alert"]').text()).toContain('different organization or profile version');
    expect(wrapper.text()).not.toContain('Synthetic flood program');
  });

  it('hides ready results immediately when the saved profile version changes', async () => {
    render();
    await wrapper.setProps({ context: { ...matchContext, profileVersion: 3 } });
    expect(wrapper.findAll('article')).toHaveLength(0);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });

  it('does not retain expanded evidence when the run changes', async () => {
    render();
    const previousDetails = wrapper.get('article details').element;
    previousDetails.open = true;
    await wrapper.setProps({ run: { ...makeMatchRun(), explanationHash: 'd'.repeat(64) } });
    expect(wrapper.get('article details').element).not.toBe(previousDetails);
    expect(wrapper.get('article details').attributes('open')).toBeUndefined();
  });

  it('fails closed on incomplete, malformed, or contradictory results', () => {
    const run = makeMatchRun();
    run.results[3].rank = 1;
    render({ run });
    expect(wrapper.findAll('article')).toHaveLength(0);
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be safely displayed');
  });

  it('shows a genuine empty run without claiming no suitable grants exist', () => {
    render({
      run: {
        ...makeMatchRun(), results: [], candidateCount: 0, rankedCount: 0, blockedCount: 0,
      },
    });
    expect(wrapper.findAll('article')).toHaveLength(0);
    expect(wrapper.get('[role="status"]').text()).toContain('does not establish that no suitable grants exist');
  });

  it('only emits an explicit retry request; it does not start requests or reveal raw errors', async () => {
    render({ state: 'error', errorCode: 'SQL secret token', retryable: true });
    expect(wrapper.text()).not.toContain('SQL secret token');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
    expect(wrapper.findAll('article')).toHaveLength(0);
  });

  it('has labelled sections and result cards with unique DOM identities across instances', () => {
    render();
    const second = mount(RankedMatchResults, { props: { state: 'ready', run: makeMatchRun(), context: matchContext } });
    const ids = [...wrapper.findAll('[id]'), ...second.findAll('[id]')].map((item) => item.attributes('id'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(wrapper.get(`#${wrapper.attributes('aria-labelledby')}`).text()).toBe('Grant match results');
    wrapper.findAll('article').forEach((article) => {
      expect(wrapper.find(`#${article.attributes('aria-labelledby')}`).exists()).toBe(true);
    });
    second.unmount();
  });
});
