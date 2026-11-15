import * as fetchApi from '@/helpers/fetchApi';
import { grantId } from '@/helpers/grantDocumentHandoff';

const DEADLINES_PER_PAGE = 500;

function initialState() {
  return {
    portfolio: [],
    reviewNeeded: [],
    pagination: null,
    agencyId: null,
    scope: null,
    requestId: 0,
  };
}

function sameScope(left, right) {
  return left?.documentId === right?.documentId && left?.grantId === right?.grantId;
}

export default {
  namespaced: true,
  state: initialState,
  getters: {
    portfolio: (state) => state.portfolio,
    reviewNeeded: (state) => state.reviewNeeded,
    pagination: (state) => state.pagination,
  },
  actions: {
    async fetchDeadlines({ commit, rootGetters, state }, scope = null) {
      const agencyId = rootGetters['users/selectedAgencyId'];
      const requestId = state.requestId + 1;
      commit('START_REQUEST', { agencyId, scope, requestId });
      const query = fetchApi.serializeQuery({ perPage: DEADLINES_PER_PAGE, documentId: scope?.documentId });
      const response = await fetchApi.get(`/api/organizations/${agencyId}/compliance/deadlines${query}`);
      if (state.requestId !== requestId || rootGetters['users/selectedAgencyId'] !== agencyId) return;
      if (scope && (response.document?.id !== scope.documentId || grantId(response.document.grantId) !== scope.grantId)) {
        throw new Error('Deadline response does not match the selected grant and document.');
      }
      commit('SET_DEADLINES', response);
    },
    async updateDeadline({
      commit, dispatch, rootGetters, state,
    }, {
      checklistItemId, changes, successMessage, verify = false,
    }) {
      const agencyId = rootGetters['users/selectedAgencyId'];
      const { scope } = state;
      const isCurrentContext = () => rootGetters['users/selectedAgencyId'] === agencyId
        && sameScope(state.scope, scope);
      const url = `/api/organizations/${agencyId}/compliance/deadlines/${checklistItemId}${verify ? '/verification' : ''}`;
      try {
        await fetchApi.patch(url, changes);
      } catch (error) {
        if ([404, 409].includes(error.response?.status) && isCurrentContext()) {
          await dispatch('fetchDeadlines', scope).catch(() => {});
        }
        throw error;
      }
      if (!isCurrentContext()) return;
      try {
        await dispatch('fetchDeadlines', scope);
      } catch (error) {
        if (isCurrentContext()) {
          commit('alerts/addAlert', {
            text: 'The change was saved, but the deadlines could not be refreshed. Reload the page to see it.',
            level: 'warn',
          }, { root: true });
        }
        return;
      }
      if (successMessage && isCurrentContext()) {
        commit('alerts/addAlert', { text: successMessage, level: 'ok' }, { root: true });
      }
    },
  },
  mutations: {
    START_REQUEST(state, { agencyId, scope, requestId }) {
      if (state.agencyId !== agencyId || !sameScope(state.scope, scope)) {
        Object.assign(state, initialState());
      }
      Object.assign(state, { agencyId, scope, requestId });
    },
    SET_DEADLINES(state, { data, pagination }) {
      state.portfolio = data.portfolio;
      state.reviewNeeded = data.reviewNeeded;
      state.pagination = pagination;
    },
  },
};
