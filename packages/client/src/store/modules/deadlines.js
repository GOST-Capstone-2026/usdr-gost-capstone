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
  },
  mutations: {
    SET_DEADLINES(state, { data, pagination }) {
      state.portfolio = data.portfolio;
      state.reviewNeeded = data.reviewNeeded;
      state.pagination = pagination;
    },
  },
};
