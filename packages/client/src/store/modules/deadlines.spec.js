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

describe('deadlines store', () => {
  let context;

  beforeEach(() => {
    vi.clearAllMocks();
    context = {
      commit: vi.fn(),
      dispatch: vi.fn().mockResolvedValue(undefined),
      rootGetters: { 'users/selectedAgencyId': 7 },
    };
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
  });
});
