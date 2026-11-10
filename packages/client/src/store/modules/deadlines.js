import * as fetchApi from '@/helpers/fetchApi';

const DEADLINES_PER_PAGE = 500;

function initialState() {
  return {
    portfolio: [],
    reviewNeeded: [],
    pagination: null,
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
    async fetchDeadlines({ commit, rootGetters }) {
      const query = fetchApi.serializeQuery({ perPage: DEADLINES_PER_PAGE });
      const response = await fetchApi.get(`/api/organizations/${rootGetters['users/selectedAgencyId']}/compliance/deadlines${query}`);
      commit('SET_DEADLINES', response);
    },
    async updateDeadline({ commit, dispatch, rootGetters }, { checklistItemId, changes, successMessage }) {
      const url = `/api/organizations/${rootGetters['users/selectedAgencyId']}/compliance/deadlines/${checklistItemId}`;
      try {
        await fetchApi.patch(url, changes);
      } catch (error) {
        if (error.response && error.response.status === 404) {
          await dispatch('fetchDeadlines');
        }
        throw error;
      }
      try {
        await dispatch('fetchDeadlines');
      } catch (error) {
        commit('alerts/addAlert', {
          text: 'The change was saved, but the deadlines could not be refreshed. Reload the page to see it.',
          level: 'warn',
        }, { root: true });
        return;
      }
      if (successMessage) {
        commit('alerts/addAlert', { text: successMessage, level: 'ok' }, { root: true });
      }
    },
  },
  mutations: {
    SET_DEADLINES(state, { data, pagination }) {
      state.portfolio = data.portfolio;
      state.reviewNeeded = data.reviewNeeded;
      state.pagination = pagination;
    },
  },
};
