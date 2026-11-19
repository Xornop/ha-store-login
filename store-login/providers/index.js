'use strict';

// To add a store: create providers/<store>.js and list it here.
const stores = [require('./ah'), require('./jumbo'), require('./lidl'), require('./action')];
const byKey = Object.fromEntries(stores.map((s) => [s.key, s]));

module.exports = {
  list: stores.map(({ key, name }) => ({ key, name })),
  create(key) {
    const store = byKey[key] || stores[0];
    return { key: store.key, name: store.name, ...store.create() };
  },
};
