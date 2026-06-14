import { World, Faction, Alert, Modifier } from '../../types.js';
import { pushAlert } from '../settlement.js';
import { goldF, settlementsF } from '../diplomacy/helpers.js';
import { spendGold } from '../economy.js';

const EVENT_INTERVAL = 1000;
const EVENT_DURATION = 500;

export function eventsSystem(world: World) {
  if (world.tick % EVENT_INTERVAL !== 0 || world.tick === 0) return;

  for (const f of world.factions) {
    if (f.eliminated) continue;
    
    // Cleanup expired modifiers
    if (f.modifiers) {
      f.modifiers = f.modifiers.filter(m => m.expiresAt > world.tick);
    }
    
    // Simple deterministic roll per faction per interval
    const roll = world.rng.next() * 100;
    
    if (roll < 10) {
      triggerBountifulHarvest(world, f.id);
    } else if (roll < 20) {
      triggerDrought(world, f.id);
    } else if (roll < 30) {
      triggerMasterCaravaneer(world, f.id);
    }
  }
}

function triggerBountifulHarvest(world: World, fid: number) {
  pushAlert(world, {
    type: 'EVENT',
    severity: 'INFO',
    factionId: fid,
    tick: world.tick,
    msg: 'A bountiful harvest has been reported across the kingdom! Food production increased for a season.',
  });
  
  addModifier(world, fid, {
    id: 'bountiful_harvest',
    type: 'food_rate',
    value: 1.5,
    expiresAt: world.tick + EVENT_DURATION
  });
}

function triggerDrought(world: World, fid: number) {
  const costFood = settlementsF(world, fid).length * 150;
  pushAlert(world, {
    type: 'EVENT',
    severity: 'IMPORTANT',
    factionId: fid,
    tick: world.tick,
    eventId: 'drought',
    msg: 'A severe drought is threatening our crops. What shall we do?',
    expiresAt: world.tick + 200,
    choices: [
      { id: 'open_granaries', text: 'Open the granaries', cost: { food: costFood } },
      { id: 'ride_it_out', text: 'Ride it out' }
    ]
  });
}

function triggerMasterCaravaneer(world: World, fid: number) {
  pushAlert(world, {
    type: 'EVENT',
    severity: 'INFO',
    factionId: fid,
    tick: world.tick,
    eventId: 'master_caravaneer',
    msg: 'A master caravaneer is passing through. He offers to sell us rare goods or buy our surplus.',
    expiresAt: world.tick + 200,
    choices: [
      { id: 'buy_tools', text: 'Buy tools for expansion', cost: { gold: 500 } },
      { id: 'sell_surplus', text: 'Sell surplus materials' },
      { id: 'ignore', text: 'Ignore him' }
    ]
  });
}

export function addModifier(world: World, fid: number, mod: Modifier) {
  const f = world.factions[fid];
  if (!f.modifiers) f.modifiers = [];
  f.modifiers = f.modifiers.filter(m => m.id !== mod.id);
  f.modifiers.push(mod);
}

export function resolveEventChoice(world: World, fid: number, eventId: string, choiceId: string) {
  const f = world.factions[fid];
  
  if (eventId === 'drought') {
    if (choiceId === 'open_granaries') {
      const setts = settlementsF(world, fid);
      const costPerSett = 150;
      for (const s of setts) {
        s.stock.food = Math.max(0, s.stock.food - costPerSett);
      }
      pushAlert(world, { type: 'EVENT', severity: 'INFO', factionId: fid, tick: world.tick, msg: 'Granaries opened. The drought was mitigated.' });
    } else {
      addModifier(world, fid, { id: 'drought', type: 'food_rate', value: 0.5, expiresAt: world.tick + EVENT_DURATION });
      pushAlert(world, { type: 'EVENT', severity: 'IMPORTANT', factionId: fid, tick: world.tick, msg: 'We rode out the drought. Food production will be halved.' });
    }
  } else if (eventId === 'master_caravaneer') {
    if (choiceId === 'buy_tools') {
      spendGold(world, fid, 500);
      addModifier(world, fid, { id: 'master_tools', type: 'tool_production', value: 2.0, expiresAt: world.tick + EVENT_DURATION });
      pushAlert(world, { type: 'EVENT', severity: 'INFO', factionId: fid, tick: world.tick, msg: 'We purchased tools from the Caravaneer.' });
    } else if (choiceId === 'sell_surplus') {
      f.treasury += 500;
      pushAlert(world, { type: 'EVENT', severity: 'INFO', factionId: fid, tick: world.tick, msg: 'We sold surplus materials to the Caravaneer.' });
    }
  }
}

export function resolvePendingEvents(world: World) {
  for (const alert of world.alerts) {
    if (alert.choices && alert.expiresAt && alert.factionId !== null) {
      if (alert.factionId === world.playerFactionId) {
        if (world.tick >= alert.expiresAt) {
          resolveEventChoice(world, alert.factionId, alert.eventId!, alert.choices[alert.choices.length - 1].id);
          alert.choices = undefined;
        }
      } else {
        const affordableChoices = alert.choices.filter(c => {
          if (c.cost?.gold && goldF(world, alert.factionId!) < c.cost.gold) return false;
          return true;
        });
        const choice = affordableChoices.length > 0 ? affordableChoices[0].id : alert.choices[alert.choices.length - 1].id;
        resolveEventChoice(world, alert.factionId, alert.eventId!, choice);
        alert.choices = undefined;
      }
    }
  }
}

export function getModifier(world: World, fid: number, type: string, defaultVal = 1.0): number {
  const f = world.factions[fid];
  if (!f || !f.modifiers) return defaultVal;
  
  let val = defaultVal;
  for (const m of f.modifiers) {
    if (m.type === type && m.expiresAt > world.tick) {
      val *= m.value;
    }
  }
  return val;
}
