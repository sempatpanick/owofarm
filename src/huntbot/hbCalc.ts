import type { HuntbotTrait, HuntbotWeights, UpgradeDetails } from './types';

interface TraitFormula {
  inc: number;
  pow: number;
  base: number;
  upg: number;
  max: number;
  weight: number;
}

const TRAIT_FORMULAS: Record<HuntbotTrait, TraitFormula> = {
  efficiency: {
    inc: 10,
    pow: 1.748,
    base: 25,
    upg: 1,
    max: 215,
    weight: 4,
  },
  duration: {
    inc: 10,
    pow: 1.7,
    base: 0.5,
    upg: 0.1,
    max: 235,
    weight: 2,
  },
  cost: { inc: 1000, pow: 3.4, base: 10, upg: -1, max: 5, weight: 5 },
  gain: { inc: 10, pow: 1.8, base: 0, upg: 25, max: 200, weight: 4 },
  exp: { inc: 10, pow: 1.8, base: 0, upg: 35, max: 200, weight: 3 },
  radar: {
    inc: 50,
    pow: 2.5,
    base: 0,
    upg: 0.00000004,
    max: 999,
    weight: 1,
  },
};

export function allocateEssence(
  inputData: UpgradeDetails,
  weights: HuntbotWeights
): Record<string, number> {
  const traits: Record<HuntbotTrait, TraitFormula> = structuredClone(TRAIT_FORMULAS);

  for (const trait of Object.keys(traits) as HuntbotTrait[]) {
    traits[trait].weight = weights[trait] ?? 0;
  }

  const availableEssence = inputData.essence ?? 0;

  const enabledTraits = Object.fromEntries(
    (Object.keys(traits) as HuntbotTrait[])
      .filter((trait) => inputData[trait].enabled)
      .map((trait) => [trait, inputData[trait]])
  ) as Pick<UpgradeDetails, HuntbotTrait>;

  const allocation = Object.fromEntries(
    Object.keys(enabledTraits).map((trait) => [trait, 0])
  ) as Record<string, number>;

  const currentLevels = Object.fromEntries(
    Object.entries(enabledTraits).map(([trait, data]) => [trait, data.current_level ?? 0])
  ) as Record<string, number>;

  const currentInvested = Object.fromEntries(
    Object.entries(enabledTraits).map(([trait, data]) => [trait, data.invested ?? 0])
  ) as Record<string, number>;

  let remaining = availableEssence;

  while (remaining > 0) {
    let bestTrait: string | null = null;
    let bestRatio = -1;
    let costForBest: number | null = null;

    for (const trait of Object.keys(allocation)) {
      const level = currentLevels[trait];
      const traitData = traits[trait as HuntbotTrait];

      if (level >= traitData.max) {
        continue;
      }

      const nextLevel = level + 1;
      const fullCost = Math.floor(traitData.inc * Math.pow(nextLevel, traitData.pow));
      const invested = currentInvested[trait] ?? 0;
      const required = Math.max(0, fullCost - invested);

      if (required === 0) {
        currentLevels[trait] += 1;
        currentInvested[trait] = 0;
        continue;
      }

      const benefit = traitData.weight;
      const ratio = required > 0 ? benefit / required : 0;

      if (required <= remaining && ratio > bestRatio) {
        bestRatio = ratio;
        bestTrait = trait;
        costForBest = required;
      }
    }

    if (bestTrait !== null && costForBest !== null) {
      allocation[bestTrait] += costForBest;
      remaining -= costForBest;
      currentLevels[bestTrait] += 1;
      currentInvested[bestTrait] = 0;
    } else {
      bestTrait = null;
      bestRatio = -1;

      for (const trait of Object.keys(allocation)) {
        const level = currentLevels[trait];
        const traitData = traits[trait as HuntbotTrait];

        if (level >= traitData.max) {
          continue;
        }

        const nextLevel = level + 1;
        const fullCost = Math.floor(traitData.inc * Math.pow(nextLevel, traitData.pow));
        const invested = currentInvested[trait] ?? 0;
        const required = Math.max(0, fullCost - invested);

        if (required <= 0) {
          continue;
        }

        const benefit = traitData.weight;
        const ratio = required > 0 ? benefit / required : 0;

        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestTrait = trait;
        }
      }

      if (bestTrait !== null) {
        allocation[bestTrait] += remaining;
        currentInvested[bestTrait] += remaining;
        remaining = 0;
      } else {
        break;
      }
    }
  }

  return allocation;
}
