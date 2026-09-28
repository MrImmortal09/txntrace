import { RewardProgram } from './engine';

export interface RewardPreset {
  id: string;
  name: string;
  bank: string;
  program: RewardProgram;
}

// Merchant keywords are only attached where the SMS merchant name reliably
// identifies the tier (Swiggy, Flipkart, ...). Amazon is left out on purpose:
// "AMAZON" in an SMS can't tell a Prime order from an Amazon Pay bill payment.
const FUEL_KEYWORDS = ['fuel', 'petrol', 'hpcl', 'bpcl', 'iocl', 'indian oil', 'bharat petroleum', 'hindustan petroleum'];

/**
 * Snapshot of each card's reward structure as of Sept 2026. Copied into the
 * card row when picked (not referenced by id), so later edits to rates on the
 * phone survive — and so a future change to these presets never silently
 * rewrites history for a card that's already configured.
 */
export const REWARD_PRESETS: RewardPreset[] = [
  {
    id: 'idfc_mayura',
    name: 'IDFC FIRST Mayura',
    bank: 'IDFC First Bank',
    program: {
      kind: 'points',
      blockSize: 150,
      pointValue: 0.25,
      autoCredit: false,
      defaultTierId: 'general',
      tiers: [
        { id: 'general', label: 'General (10X above ₹20k/cycle)', rate: 5, accelerateAfter: 20000, acceleratedRate: 10 },
        { id: 'international', label: 'International', rate: 5 },
        { id: 'rent_gov', label: 'Rent / Govt / Wallet / Education', rate: 3 },
        { id: 'insurance_util', label: 'Insurance / Utilities', rate: 1 },
        { id: 'hotel_app', label: 'Hotel via IDFC app', rate: 60 },
        { id: 'flight_app', label: 'Flight via IDFC app', rate: 40 },
        { id: 'excluded', label: 'Fuel / EMI / Fees (no rewards)', rate: 0, keywords: FUEL_KEYWORDS },
      ],
      caps: [],
    },
  },
  {
    id: 'sbi_elite',
    name: 'SBI Elite',
    bank: 'State Bank of India',
    program: {
      kind: 'points',
      blockSize: 100,
      pointValue: 0.25,
      autoCredit: false,
      defaultTierId: 'other',
      tiers: [
        { id: 'dining_grocery', label: 'Dining / Departmental / Grocery (5X)', rate: 10 },
        { id: 'other', label: 'Other domestic', rate: 2 },
        { id: 'international', label: 'International', rate: 2 },
        { id: 'excluded', label: 'Fuel / Govt / Rent / Wallet (no rewards)', rate: 0, keywords: FUEL_KEYWORDS },
      ],
      caps: [],
    },
  },
  {
    id: 'icici_amazon_pay',
    name: 'ICICI Amazon Pay',
    bank: 'ICICI Bank',
    program: {
      kind: 'cashback',
      blockSize: 0,
      pointValue: 1,
      autoCredit: true,
      defaultTierId: 'other',
      tiers: [
        { id: 'amazon_prime', label: 'Amazon.in (Prime)', rate: 5 },
        { id: 'amazon_non_prime', label: 'Amazon.in (non-Prime)', rate: 3 },
        { id: 'amazon_pay', label: 'Amazon Pay bills / recharge / flights', rate: 2 },
        { id: 'partner', label: 'Amazon Pay partners (Swiggy, Zomato, Uber…)', rate: 2 },
        { id: 'other', label: 'Everything else', rate: 1 },
        { id: 'excluded', label: 'Fuel / Rent / EMI / Govt / Intl (no rewards)', rate: 0, keywords: FUEL_KEYWORDS },
      ],
      caps: [],
    },
  },
  {
    id: 'sbi_cashback',
    name: 'SBI Cashback',
    bank: 'State Bank of India',
    program: {
      kind: 'cashback',
      blockSize: 0,
      pointValue: 1,
      autoCredit: true,
      defaultTierId: 'online',
      tiers: [
        { id: 'online', label: 'Online', rate: 5 },
        { id: 'offline', label: 'Offline (POS)', rate: 1 },
        { id: 'excluded', label: 'Utilities / Insurance / Fuel / Rent… (no rewards)', rate: 0, keywords: FUEL_KEYWORDS },
      ],
      caps: [
        { id: 'online_cap', label: 'Online cap', limit: 2000, period: 'cycle', tierIds: ['online'] },
        { id: 'offline_cap', label: 'Offline cap', limit: 2000, period: 'cycle', tierIds: ['offline'] },
        { id: 'total_cap', label: 'Combined cap', limit: 4000, period: 'cycle', tierIds: ['online', 'offline'] },
      ],
    },
  },
  {
    id: 'sbi_phonepe_black',
    name: 'SBI PhonePe SELECT BLACK',
    bank: 'State Bank of India',
    program: {
      kind: 'points',
      blockSize: 100,
      pointValue: 1,
      autoCredit: false,
      defaultTierId: 'other',
      tiers: [
        { id: 'phonepe', label: 'PhonePe / Pincode app', rate: 10, keywords: ['phonepe', 'pincode'] },
        { id: 'online', label: 'Other online', rate: 5 },
        { id: 'insurance', label: 'Insurance', rate: 1 },
        { id: 'other', label: 'All other spends', rate: 1 },
        { id: 'excluded', label: 'Fuel / Wallet / Rent / Govt / EMI (no rewards)', rate: 0, keywords: FUEL_KEYWORDS },
      ],
      caps: [
        { id: 'phonepe_cap', label: 'PhonePe cap', limit: 2000, period: 'cycle', tierIds: ['phonepe'] },
        { id: 'online_cap', label: 'Online cap', limit: 2000, period: 'cycle', tierIds: ['online'] },
        { id: 'insurance_cap', label: 'Insurance cap', limit: 500, period: 'cycle', tierIds: ['insurance'] },
        { id: 'other_cap', label: 'Other spends cap', limit: 1000, period: 'cycle', tierIds: ['other'] },
      ],
    },
  },
  {
    id: 'yes_ace',
    name: 'YES Bank Ace',
    bank: 'Yes Bank',
    program: {
      kind: 'points',
      blockSize: 200,
      pointValue: 0.1,
      autoCredit: false,
      defaultTierId: 'offline',
      tiers: [
        { id: 'online', label: 'Online shopping', rate: 8 },
        { id: 'offline', label: 'Offline shopping', rate: 4 },
        { id: 'upi_rupay', label: 'RuPay UPI (above ₹2k/month)', rate: 4 },
        { id: 'select', label: 'Insurance / Education / Utilities / Telecom', rate: 2 },
        { id: 'excluded', label: 'Rent / Fuel / Govt / Wallet / EMI (no rewards)', rate: 0, keywords: FUEL_KEYWORDS },
      ],
      caps: [
        { id: 'cycle_cap', label: 'Cycle cap', limit: 5000, period: 'cycle', tierIds: ['online', 'offline', 'upi_rupay', 'select'] },
      ],
    },
  },
  {
    id: 'icici_coral',
    name: 'ICICI Coral',
    bank: 'ICICI Bank',
    program: {
      kind: 'points',
      blockSize: 100,
      pointValue: 0.25,
      autoCredit: false,
      defaultTierId: 'general',
      tiers: [
        { id: 'general', label: 'General spend', rate: 2 },
        { id: 'utilities_insurance', label: 'Utilities / Insurance', rate: 1 },
        { id: 'excluded', label: 'Fuel (no rewards)', rate: 0, keywords: FUEL_KEYWORDS },
      ],
      caps: [],
    },
  },
  {
    id: 'hdfc_swiggy_blck',
    name: 'HDFC Swiggy BLCK',
    bank: 'HDFC Bank',
    program: {
      kind: 'cashback',
      blockSize: 0,
      pointValue: 1,
      autoCredit: true,
      defaultTierId: 'other',
      tiers: [
        { id: 'swiggy', label: 'Swiggy (Food / Instamart / Dineout)', rate: 10, minAmount: 249, keywords: ['swiggy', 'instamart'] },
        {
          id: 'select_online',
          label: 'Select online (Amazon, Flipkart, Myntra, cabs…)',
          rate: 5,
          minAmount: 100,
          keywords: ['flipkart', 'myntra', 'nykaa', 'cleartrip', 'bookmyshow', 'uber', 'ola cabs', 'rapido'],
        },
        { id: 'other', label: 'Everything else', rate: 1 },
        { id: 'excluded', label: 'Fuel / Rent / Govt / Wallet / EMI (no rewards)', rate: 0, keywords: FUEL_KEYWORDS },
      ],
      caps: [
        { id: 'swiggy_cap', label: 'Swiggy cap', limit: 1500, period: 'cycle', tierIds: ['swiggy'] },
        { id: 'select_cap', label: 'Select online cap', limit: 1500, period: 'cycle', tierIds: ['select_online'] },
        { id: 'other_cap', label: 'Everything else cap', limit: 1000, period: 'cycle', tierIds: ['other'] },
      ],
    },
  },
  {
    id: 'axis_privilege',
    name: 'Axis Privilege',
    bank: 'Axis Bank',
    program: {
      kind: 'points',
      blockSize: 200,
      pointValue: 0.2,
      autoCredit: false,
      defaultTierId: 'retail',
      tiers: [
        { id: 'retail', label: 'Retail (domestic & intl)', rate: 10 },
        { id: 'excluded', label: 'Utilities / Rent / Wallet / Fuel… (no rewards)', rate: 0, keywords: FUEL_KEYWORDS },
      ],
      caps: [],
    },
  },
  {
    id: 'axis_flipkart',
    name: 'Axis Flipkart',
    bank: 'Axis Bank',
    program: {
      kind: 'cashback',
      blockSize: 0,
      pointValue: 1,
      autoCredit: true,
      defaultTierId: 'other',
      tiers: [
        { id: 'myntra', label: 'Myntra', rate: 7.5, minAmount: 100, keywords: ['myntra'] },
        { id: 'flipkart', label: 'Flipkart & Cleartrip', rate: 5, minAmount: 100, keywords: ['flipkart', 'cleartrip'] },
        { id: 'preferred', label: 'Preferred (Swiggy, Uber, PVR, Cult.fit)', rate: 4, minAmount: 100, keywords: ['swiggy', 'uber', 'pvr', 'cult.fit', 'cultfit'] },
        { id: 'other', label: 'Everything else', rate: 1.5, minAmount: 100 },
        { id: 'excluded', label: 'Fuel / Rent / Utilities / Wallet… (no rewards)', rate: 0, keywords: FUEL_KEYWORDS },
      ],
      caps: [
        { id: 'myntra_cap', label: 'Myntra cap', limit: 4000, period: 'quarter', tierIds: ['myntra'] },
        { id: 'flipkart_cap', label: 'Flipkart & Cleartrip cap', limit: 4000, period: 'quarter', tierIds: ['flipkart'] },
        { id: 'preferred_cap', label: 'Preferred merchants cap', limit: 4000, period: 'quarter', tierIds: ['preferred'] },
      ],
    },
  },
  {
    id: 'custom_cashback',
    name: 'Custom cashback card',
    bank: '',
    program: {
      kind: 'cashback',
      blockSize: 0,
      pointValue: 1,
      autoCredit: true,
      defaultTierId: 'base',
      tiers: [
        { id: 'base', label: 'Base', rate: 1 },
        { id: 'excluded', label: 'No rewards', rate: 0 },
      ],
      caps: [],
    },
  },
  {
    id: 'custom_points',
    name: 'Custom reward points card',
    bank: '',
    program: {
      kind: 'points',
      blockSize: 100,
      pointValue: 0.25,
      autoCredit: false,
      defaultTierId: 'base',
      tiers: [
        { id: 'base', label: 'Base', rate: 2 },
        { id: 'excluded', label: 'No rewards', rate: 0 },
      ],
      caps: [],
    },
  },
];

export const findPreset = (id: string | null | undefined): RewardPreset | undefined =>
  REWARD_PRESETS.find(p => p.id === id);

/** Deep copy so edits made in the card form never mutate the shared preset. */
export const clonePresetProgram = (preset: RewardPreset): RewardProgram =>
  JSON.parse(JSON.stringify(preset.program));
