import React from 'react';
import { Platform } from 'react-native';
import { IconDaily, IconFriends, IconHome, IconMore, IconReview } from '../TabIcons';
import { ReviewCardDemo, SmsFlowDemo, SwipeRowDemo } from './GestureDemos';
import { CardsVisual, FriendsVisual, HomeVisual, TabRecapVisual, WelcomeVisual } from './MockVisuals';

export interface SlidePoint {
  icon: string;
  lead: string;
  text: string;
}

export interface Slide {
  key: string;
  /** Where in the app this lives, shown above the title. */
  eyebrow?: { label: string; Icon?: React.ComponentType<{ color: string; size?: number }> };
  title: string;
  body: string;
  points: SlidePoint[];
  /** `active` is true while this slide is the one on screen. */
  Visual: React.ComponentType<{ active: boolean }>;
  footnote?: string;
}

const isIOS = Platform.OS === 'ios';

export const SLIDES: Slide[] = [
  {
    key: 'welcome',
    title: 'Welcome to TxnTrace',
    body: 'TxnTrace turns the SMS your bank already sends into a clear record of your spending. No bank logins, and no typing in every expense.',
    points: [
      { icon: '📩', lead: 'Reads bank SMS', text: 'and picks out the amount, merchant and account.' },
      { icon: '✅', lead: 'You stay in charge:', text: 'mark each spend as yours, or split it with friends.' },
      { icon: '🔒', lead: 'Kept on this phone.', text: 'Cloud backup and web sync are optional.' },
    ],
    Visual: WelcomeVisual,
    footnote: 'Swipe left or tap Next to continue',
  },
  {
    key: 'sms',
    eyebrow: { label: 'How it works' },
    title: 'Bank SMS become transactions',
    body: isIOS
      ? 'iOS doesn’t let apps read your messages, so a one-time Shortcuts automation hands each bank SMS to TxnTrace in the background.'
      : 'When a bank SMS arrives, TxnTrace reads it on your phone and adds it to your Daily list. Allow SMS access when Android asks; that’s what makes it automatic.',
    points: [
      isIOS
        ? {
            icon: '⚙️',
            lead: 'Set it up once:',
            text: 'follow the Shortcuts automation steps in More → Settings. Only messages that arrive after setup are captured.',
          }
        : {
            icon: '📲',
            lead: 'Automatic:',
            text: 'new bank SMS are picked up as they arrive. Messages already in your inbox aren’t imported.',
          },
      {
        icon: '➕',
        lead: 'Paste one yourself:',
        text: 'tap + on the Daily tab and paste a bank SMS. You see what was read before you save it.',
      },
      { icon: '🧹', lead: 'No duplicates:', text: 'the same transaction is only recorded once.' },
    ],
    Visual: SmsFlowDemo,
  },
  {
    key: 'daily',
    eyebrow: { label: 'Daily tab', Icon: IconDaily },
    title: 'Daily: sort out new transactions',
    body: 'Every new transaction waits in Needs Review until you say what it is. The totals at the top show what’s still pending.',
    points: [
      { icon: '👉', lead: 'Swipe right', text: 'to mark a transaction as yours.' },
      { icon: '👆', lead: 'Double-tap', text: 'does the same, and is quicker through a long list.' },
      { icon: '🔍', lead: 'Tap once', text: 'to see the full details and the original SMS.' },
      { icon: '👥', lead: 'Split', text: 'shares a spend with friends. For money coming in, pick Mine or Friend.' },
    ],
    Visual: SwipeRowDemo,
  },
  {
    key: 'review',
    eyebrow: { label: 'Review tab', Icon: IconReview },
    title: 'Review: one card at a time',
    body: 'For tidier records, go through the same queue card by card and give each spend a category and a note.',
    points: [
      {
        icon: '↔️',
        lead: 'Swipe the card',
        text: 'left for the next one and right for the previous one. Swiping never saves anything.',
      },
      {
        icon: '🏷️',
        lead: 'Pick a category, add a note,',
        text: 'like “team lunch”, then tap Review & Next to save it and move on.',
      },
      {
        icon: '👥',
        lead: 'Split this',
        text: 'divides the full amount between the contacts you pick. If you had a share too, lower theirs.',
      },
      {
        icon: '💳',
        lead: 'Credit card spend?',
        text: 'Pick the reward tier it earns, such as 5% on online shopping.',
      },
    ],
    Visual: ReviewCardDemo,
  },
  {
    key: 'friends',
    eyebrow: { label: 'Friends tab', Icon: IconFriends },
    title: 'Friends: who owes whom',
    body: 'Splits turn into balances. When a friend pays you back, the money clears their oldest dues first.',
    points: [
      {
        icon: '🔗',
        lead: 'Match a payer once:',
        text: 'tap Match or Friend and pick the contact. Later payments from the same name match by themselves.',
      },
      {
        icon: '💸',
        lead: 'I Paid Them / They Paid Me',
        text: 'record money that never showed up in a bank SMS, like cash.',
      },
      { icon: '🤝', lead: 'Settle Up', text: 'clears what you owe a friend. Tap any entry to edit or remove it.' },
      { icon: '➕', lead: 'The + button', text: 'starts a balance with someone you haven’t split with yet.' },
    ],
    Visual: FriendsVisual,
    footnote: 'After the tour, TxnTrace asks for your contacts, so you can pick friends and their payments match to them.',
  },
  {
    key: 'home',
    eyebrow: { label: 'Home tab', Icon: IconHome },
    title: 'Home: where your money went',
    body: 'The dashboard adds up the spends you marked as yours. Split spends count toward friend balances instead.',
    points: [
      {
        icon: '📅',
        lead: 'Tap ‹ ›',
        text: 'to step through months, or tap the month for Last 30 days, This year or a custom range.',
      },
      { icon: '📊', lead: 'Spend by category,', text: 'plus every spend in a list you can sort by category, date or amount.' },
      { icon: '✏️', lead: 'Tap a spend, then Edit,', text: 'to fix its category or add a note.' },
      { icon: '🔄', lead: 'Pull down', text: 'to refresh.' },
    ],
    Visual: HomeVisual,
  },
  {
    key: 'cards',
    eyebrow: { label: 'More → Cards, Dues & Rewards', Icon: IconMore },
    title: 'Credit cards: dues and rewards',
    body: 'Add your cards once. Card spends are linked automatically by the last digits in the SMS.',
    points: [
      { icon: '🗓️', lead: 'Set the statement day', text: 'to see what’s billed, what you’ve paid and what’s left to pay.' },
      {
        icon: '🎁',
        lead: 'Choose a rewards program',
        text: 'to estimate the cashback or points each spend earns, caps included.',
      },
      {
        icon: '🔎',
        lead: 'Log what you received',
        text: 'and TxnTrace tells you if the bank paid less than expected.',
      },
    ],
    Visual: CardsVisual,
  },
  {
    key: 'done',
    eyebrow: { label: 'Good to know' },
    title: 'You’re all set',
    body: 'That’s the tour. A few extras worth knowing:',
    points: [
      { icon: '📋', lead: 'Hold to copy', text: 'any field in a transaction’s details, like the amount or the SMS.' },
      { icon: '📍', lead: 'Places:', text: 'when a spend has one, tap it to open Google Maps.' },
      { icon: '🧾', lead: 'SMS Logs', text: 'in More → Settings list every message TxnTrace saw and whether it could read it.' },
      { icon: '🌗', lead: 'Theme, backup and sync', text: 'are in More → Settings too.' },
      { icon: '🔁', lead: 'See this tour again', text: 'any time from More → Settings → Help.' },
    ],
    Visual: TabRecapVisual,
  },
];
