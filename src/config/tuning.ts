/**
 * SWARM SURGE — central balancing / tuning file.
 *
 * Every number that affects game feel, difficulty, economy or pacing lives here
 * so the game can be tuned without touching gameplay code.
 */

export const TUNING = {
  /** Fixed simulation step. The sim is deterministic at this rate. */
  fixedDt: 1 / 60,

  world: {
    /** Half width of the playable track in world units. */
    trackHalfWidth: 160,
    unitRadius: 5,
    /**
     * Hard cap on simultaneous physical units (performance). Beyond it, units
     * carry a "weight" (one blip = several soldiers, drawn bigger), so the
     * logical army can grow without extra entities.
     */
    maxUnits: 240,
    /** Soft ceiling on the logical army used by the estimator. */
    maxArmy: 999999,
    maxEnemies: 160,
    /** How far ahead of the swarm the camera shows (world units). */
    viewAhead: 620,
    viewBehind: 120,
  },

  swarm: {
    baseForwardSpeed: 215,
    maxForwardSpeed: 330,
    /** Swarm centre lateral max speed (world units / s). */
    maxLateralSpeed: 620,
    /** Finger drag → world movement ratio (relative drag steering). */
    dragSensitivity: 1.35,
    /** Unit spring toward its formation slot (with velocity feed-forward, so no steady lag). */
    slotStiffness: 34,
    slotDamping: 11,
    spacingLoose: 9.5,
    spacingTight: 5.4,
    maxRadiusLoose: 118,
    maxRadiusTight: 64,
    /** Seconds to blend between loose and tight formation. */
    squeezeBlendTime: 0.12,
    formationYScale: 0.75,
  },

  combat: {
    /**
     * Continuous contact combat: while touching, each side deals its
     * attack * contactRate per second. Units lost per enemy is then
     * (enemyHp * enemyAtk) / (unitPower * unitHealth) — smooth in every stat.
     */
    contactRate: 3.2,
    /** Slower grind at the finale so fortress / boss fights last a few dramatic seconds. */
    finaleContactRate: 2.2,
    gruntBaseHp: 10,
    gruntBaseAtk: 10,
    gruntSpeed: 58,
    gruntRadius: 7,
    bruteHpMult: 8,
    bruteAtkMult: 2.2,
    bruteRadius: 17,
    bruteSpeed: 40,
    crateBaseHp: 30,
    /** Enemies start walking at the swarm when this close. */
    enemyAggroDistance: 260,
    fortressAtkBase: 10,
  },

  /**
   * Player's permanent upgrades. value(level) = base + perLevel*(level-1),
   * or, when `max` is set, a soft-capped curve with the same initial slope.
   */
  upgrades: {
    power: { base: 10, perLevel: 1.6, costBase: 40, costGrowth: 1.16 },
    health: { base: 10, perLevel: 2.2, costBase: 40, costGrowth: 1.16 },
    squad: { base: 8, perLevel: 1.5, costBase: 55, costGrowth: 1.17 },
    gates: { base: 0, perLevel: 0.05, max: 0.9, costBase: 70, costGrowth: 1.18 },
    surge: { base: 3.0, perLevel: 0.25, max: 8, costBase: 90, costGrowth: 1.2 },
    income: { base: 1.0, perLevel: 0.1, costBase: 80, costGrowth: 1.19 },
  },

  difficulty: {
    /** base(L) = early*(1-e^(-L/earlyK)) + mid*ln(1+L/midK) + late*L */
    early: 10,
    earlyK: 12,
    mid: 4,
    midK: 20,
    late: 0.02,
    /** Pacing saw-tooth: breather after a boss, bump on boss levels. */
    postBossBreather: -1.4,
    bossBump: 0.8,
    bossEvery: 5,
    /**
     * enemyScale = baseScale(L) * (playerPower / expectedPower(L)) ^ powerAlpha
     * powerAlpha < 1 means upgrades always help but never trivialise.
     */
    powerAlpha: 0.45,
    /** Extra enemy toughness on top of tracking the reference player: 1 + log * ln(1 + L / k). */
    enemyExtraLog: 0.22,
    enemyExtraK: 30,
    /** Reference player earns this many times a clean win's coins per level (retries, pickups, chests). */
    referenceIncomeFactor: 1.35,
    /** Adaptive adjustment from recent performance (multiplies finale HP). */
    mercyPerFail: 0.07,
    mercyMaxFails: 4,
    pressurePerWin: 0.025,
    pressureMaxWins: 5,
    /** finale HP as a fraction of typical expected damage. Rises with D. */
    finaleRatioStart: 0.42,
    finaleRatioEnd: 0.82,
    finaleRatioK: 16,
    /** Optimal play must beat the finale with this margin, else HP is clamped down. */
    finaleWinMargin: 1.15,
  },

  level: {
    lengthBase: 3800,
    lengthPerLevel: 150,
    lengthExp: 0.8,
    lengthMax: 9000,
    startRunway: 420,
    finaleRunway: 360,
    speedPerD: 4.2,
  },

  generator: {
    /** Director target army: startUnits * lerp(start, end, progress) * (1 + D * perD). */
    targetGrowthStart: 1.5,
    targetGrowthEnd: 10,
    targetGrowthPerD: 0.03,
    maxSectionAttempts: 14,
    maxLevelAttempts: 6,
    /** Newly unlocked modules get extra weight for this many levels. */
    noveltyLevels: 4,
    noveltyWeight: 3.0,
    avoidRepeatWindow: 2,
  },

  fairness: {
    /** Humans get this fraction of the swarm's real lateral speed when validating paths. */
    humanLateralFactor: 0.5,
    /** Radius of the swarm "core" that must always have a safe path. */
    coreRadius: 16,
    sampleStep: 10,
    minHazardGapSecondsStart: 1.5,
    minHazardGapSecondsEnd: 0.65,
    minHazardGapK: 25,
    maxSpikeDelta: 4.5,
    minTypicalArmy: 3,
  },

  combo: {
    /** Combo count thresholds for x2, x3, x4, x5 ... */
    tiers: [3, 7, 12, 18, 26],
    comboTimeout: 6.0,
  },

  score: {
    distancePer100: 1,
    unitGained: 2,
    gruntKill: 10,
    bruteKill: 60,
    crateBreak: 25,
    perfectHazard: 50,
    nearMiss: 30,
    survivor: 10,
    fortress: 400,
    boss: 2000,
    overflowUnit: 3,
  },

  economy: {
    winBase: 35,
    winPerLevel: 7,
    winLevelExp: 0.92,
    coinPerSurvivor: 0.5,
    failProgressShare: 0.45,
    bossCoinMult: 3,
    bossGems: 5,
    pickupCoin: 1,
    crateCoins: 6,
    gemCrateChance: 0.18,
    chestEvery: 3,
    chestCoinsLevelMult: 8,
    chestGemsMin: 2,
    chestGemsMax: 6,
    chestSkinChance: 0.08,
    reviveGemCost: 15,
    /** Head Start boost: +squad fraction and a full Surge meter for one run. */
    headStartGemCost: 5,
    headStartSquadBonus: 0.5,
  },

  ability: {
    /** Surge: meter charges by events; when full, activate for invulnerability + damage. */
    chargePerCombo: 0.09,
    chargePerKill: 0.012,
    chargePerGateUnit: 0.002,
    damageMult: 3,
    unlockLevel: 4,
    chargePerLevelUpgrade: 0.06,
  },

  juice: {
    maxShake: 14,
    shakeDecay: 2.6,
    maxParticles: 1400,
    maxFloatingTexts: 48,
    slowMoScale: 0.3,
    maxDeathSfxPerFrame: 2,
  },

  ads: {
    /** Interstitials only after this many completed levels... */
    interstitialMinLevel: 6,
    /** ...at most every N level completions... */
    interstitialEveryCompletions: 4,
    /** ...and never more often than this many seconds. */
    interstitialMinSeconds: 180,
    reviveMinProgress: 0.25,
  },
} as const;

export type Tuning = typeof TUNING;
export type UpgradeId = keyof typeof TUNING.upgrades;
export const UPGRADE_IDS: UpgradeId[] = ['power', 'health', 'squad', 'gates', 'surge', 'income'];
