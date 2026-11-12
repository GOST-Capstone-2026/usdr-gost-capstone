import {
  describe, beforeEach, it, expect, vi,
} from 'vitest';
import deadlines from '@/store/modules/deadlines';
import * as fetchApi from '@/helpers/fetchApi';

vi.mock('@/helpers/fetchApi', () => ({
  get: vi.fn(),
  patch: vi.fn(),
  serializeQuery: vi.fn(() => '?perPage=500'),
}));

const httpError = (status) => Object.assign(new Error('request failed'), { response: { status } });
const responseFor = (title) => ({ data: { portfolio: [{ title }], reviewNeeded: [] }, pagination: null });

describe('deadlines store', () => {
  let context;

  beforeEach(() => {
    vi.clearAllMocks();
    context = {
      state: deadlines.state(),
      commit: vi.fn((name, payload) => deadlines.mutations[name]?.(context.state, payload)),
      dispatch: vi.fn().mockResolvedValue(undefined),
      rootGetters: { 'users/selectedAgencyId': 7 },
    };
  });

  describe('fetchDeadlines', () => {
    it('ignores a late response for the previous team and clears the old deadlines', async () => {
      let finishOldTeam;
      fetchApi.get.mockReturnValueOnce(new Promise((resolve) => { finishOldTeam = resolve; }));
      fetchApi.get.mockResolvedValueOnce(responseFor('New team'));
      const oldTeam = deadlines.actions.fetchDeadlines(context);
      context.state.portfolio = [{ title: 'Old team' }];

      context.rootGetters['users/selectedAgencyId'] = 8;
      await deadlines.actions.fetchDeadlines(context);
      finishOldTeam(responseFor('Old team'));
      await oldTeam;

      expect(fetchApi.get).toHaveBeenLastCalledWith('/api/organizations/8/compliance/deadlines?perPage=500');
      expect(context.state.portfolio).toEqual([{ title: 'New team' }]);
    });
  });

  describe('updateDeadline', () => {
    const payload = {
      checklistItemId: 42,
      changes: { completionStatus: 'completed' },
      successMessage: 'Marked "Quarterly report" complete.',
    };

    it('sends the change for the selected organization, reloads deadlines, then shows the success alert', async () => {
      fetchApi.patch.mockResolvedValue({ deadline: {} });

      await deadlines.actions.updateDeadline(context, payload);

      expect(fetchApi.patch).toHaveBeenCalledWith(
        '/api/organizations/7/compliance/deadlines/42',
        { completionStatus: 'completed' },
      );
      expect(context.dispatch).toHaveBeenCalledWith('fetchDeadlines');
      expect(context.commit).toHaveBeenCalledWith(
        'alerts/addAlert',
        { text: 'Marked "Quarterly report" complete.', level: 'ok' },
        { root: true },
      );
      expect(fetchApi.patch.mock.invocationCallOrder[0]).toBeLessThan(context.dispatch.mock.invocationCallOrder[0]);
    });

    it('reloads deadlines and rethrows when the deadline is no longer available', async () => {
      fetchApi.patch.mockRejectedValue(httpError(404));

      await expect(deadlines.actions.updateDeadline(context, payload)).rejects.toMatchObject({ response: { status: 404 } });

      expect(context.dispatch).toHaveBeenCalledWith('fetchDeadlines');
      expect(context.commit).not.toHaveBeenCalled();
    });

    it('rethrows other errors without reloading or showing an alert', async () => {
      fetchApi.patch.mockRejectedValue(httpError(500));

      await expect(deadlines.actions.updateDeadline(context, payload)).rejects.toMatchObject({ response: { status: 500 } });

      expect(context.dispatch).not.toHaveBeenCalled();
      expect(context.commit).not.toHaveBeenCalled();
    });

    it('warns instead of failing when the change saved but the reload did not', async () => {
      fetchApi.patch.mockResolvedValue({ deadline: {} });
      context.dispatch.mockRejectedValue(new Error('network down'));

      await deadlines.actions.updateDeadline(context, payload);

      expect(context.commit).toHaveBeenCalledTimes(1);
      expect(context.commit).toHaveBeenCalledWith(
        'alerts/addAlert',
        expect.objectContaining({ level: 'warn' }),
        { root: true },
      );
    });

    it('skips the refresh and alerts when the team changes while saving', async () => {
      let finishPatch;
      fetchApi.patch.mockReturnValue(new Promise((resolve) => { finishPatch = resolve; }));
      const saving = deadlines.actions.updateDeadline(context, payload);
      context.rootGetters['users/selectedAgencyId'] = 8;
      finishPatch({ deadline: {} });

      await saving;

      expect(context.dispatch).not.toHaveBeenCalled();
      expect(context.commit).not.toHaveBeenCalled();
    });

    it('keeps the new team visible when the old team refresh after saving resolves late', async () => {
      let finishOldTeam;
      fetchApi.patch.mockResolvedValue({ deadline: {} });
      fetchApi.get.mockReturnValueOnce(new Promise((resolve) => { finishOldTeam = resolve; }));
      fetchApi.get.mockResolvedValueOnce(responseFor('New team'));
      context.dispatch.mockImplementation(() => deadlines.actions.fetchDeadlines(context));
      const saving = deadlines.actions.updateDeadline(context, payload);
      await vi.waitFor(() => expect(fetchApi.get).toHaveBeenCalledTimes(1));
      context.rootGetters['users/selectedAgencyId'] = 8;
      await deadlines.actions.fetchDeadlines(context);
      finishOldTeam(responseFor('Old team'));

      await saving;

      expect(context.state.portfolio).toEqual([{ title: 'New team' }]);
      expect(context.commit).not.toHaveBeenCalledWith('alerts/addAlert', expect.anything(), { root: true });
    });
  });
});
