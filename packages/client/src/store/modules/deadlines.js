import * as fetchApi from '@/helpers/fetchApi';

const DEADLINES_PER_PAGE = 500;

function initialState() {
  return {
    portfolio: [],
    reviewNeeded: [],
    pagination: null,
    agencyId: null,
    requestId: 0,
  };
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
    async fetchDeadlines({ commit, rootGetters, state }) {
      const agencyId = rootGetters['users/selectedAgencyId'];
      const requestId = state.requestId + 1;
      commit('START_REQUEST', { agencyId, requestId });
      const query = fetchApi.serializeQuery({ perPage: DEADLINES_PER_PAGE });
      const response = await fetchApi.get(`/api/organizations/${agencyId}/compliance/deadlines${query}`);
      if (state.requestId !== requestId || rootGetters['users/selectedAgencyId'] !== agencyId) {
        return;
      }
      commit('SET_DEADLINES', response);
    },
    async updateDeadline({ commit, dispatch, rootGetters }, { checklistItemId, changes, successMessage }) {
      const agencyId = rootGetters['users/selectedAgencyId'];
      const isSameTeam = () => rootGetters['users/selectedAgencyId'] === agencyId;
      const url = `/api/organizations/${agencyId}/compliance/deadlines/${checklistItemId}`;
      try {
        await fetchApi.patch(url, changes);
      } catch (error) {
        if (error.response && error.response.status === 404 && isSameTeam()) {
          await dispatch('fetchDeadlines');
        }
        throw error;
      }
      if (!isSameTeam()) {
        return;
      }
      try {
        await dispatch('fetchDeadlines');
      } catch (error) {
        if (isSameTeam()) {
          commit('alerts/addAlert', {
            text: 'The change was saved, but the deadlines could not be refreshed. Reload the page to see it.',
            level: 'warn',
          }, { root: true });
        }
        return;
      }
      if (successMessage && isSameTeam()) {
        commit('alerts/addAlert', { text: successMessage, level: 'ok' }, { root: true });
      }
    },
  },
  mutations: {
    START_REQUEST(state, { agencyId, requestId }) {
      if (state.agencyId !== agencyId) {
        Object.assign(state, initialState());
      }
      Object.assign(state, { agencyId, requestId });
    },
    SET_DEADLINES(state, { data, pagination }) {
      state.portfolio = data.portfolio;
      state.reviewNeeded = data.reviewNeeded;
      state.pagination = pagination;
    },
  },
};
