const config = {
  typing: true,
  prefix: 'w',
  status: {
    hunt: true,
    battle: true,
    zoo: false,
    pray: false,
    curse: false,
    gamble: false,
    lootbox: false,
    lootbox_fabled: false,
    crate: true,
    cookie: false,
    gems: true,
    inventory: true,
    quest: false,
  },
  interval: {
    send_message: 5000,
    animals: 1200000,
    zoo: 300000,
    pray: 305000,
    curse: 305000,
    gamble: {
      coinflip: 30000,
      slots: 30000,
    },
    hunt: {
      slowestTime: 50000,
      fastestTime: 200000,
    },
    battle: {
      slowestTime: 50000,
      fastestTime: 200000,
    },
    inventory: 300000,
    checklist: 1000000,
    quest: {
      owo: 32000,
      check: 60000,
    },
  },
  channels: {
    hunt: '1513744333579489310',
    quest: '1513744333579489310',
    gamble: '1513744333579489310',
  },
  target: {
    pray: '',
    curse: '',
    cookie: '469369739131617291',
  },
  owoId: '408785106942164992',
  checklist_completed: false,
};

export default config;
