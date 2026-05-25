# Balatro Game Rules Reference

Version: 1.0  
Last Updated: 2026-05-25

## Run Loop

- **Ante Structure**: Each run has 8 Antes (rounds), each with 3 Blinds: Small Blind, Big Blind, Boss Blind
- **Small/Big Blinds**: Can be skipped for Tags (bonuses); Boss Blinds must be played
- **Win Condition**: Defeat the Boss Blind at Ante 8; optionally continue in Endless Mode (Ante 9+)
- **Defeat Condition**: Play a hand and score chips to meet the Blind's requirement; limited hands and discards per Blind

Source: https://balatrowiki.org/w/Gameplay_loop

## Game Phases

- **BLIND_SELECT**: Choose to play or skip Small/Big Blind, or face Boss Blind
- **SELECTING_HAND**: Play poker hands (up to 5 cards) to score chips; use discards to improve hand
- **SHOP**: Purchase Jokers, Consumables, Vouchers, Booster Packs; reroll shop inventory
- **Booster Pack States**: Open packs (Arcana/Celestial/Standard/Buffoon/Spectral) and select cards
- **ROUND_EVAL**: Cash out after defeating Blind; earn money based on remaining hands + interest

Source: https://balatrowiki.org/w/Gameplay_loop

## Poker Hand Evaluation (Highest to Lowest)

1. **Royal Flush**: 100 chips x 8 mult (Straight Flush with 10-A)
2. **Straight Flush**: 100 chips x 8 mult (5 consecutive cards, same suit)
3. **Four of a Kind**: 60 chips x 7 mult
4. **Full House**: 40 chips x 4 mult (3 of a kind + pair)
5. **Flush**: 35 chips x 4 mult (5 cards, same suit)
6. **Straight**: 30 chips x 4 mult (5 consecutive ranks)
7. **Three of a Kind**: 30 chips x 3 mult
8. **Two Pair**: 20 chips x 2 mult
9. **Pair**: 10 chips x 2 mult
10. **High Card**: 5 chips x 1 mult

Source: https://balatrowiki.org/w/Poker_Hands

## Money Rules

- **Earning**: Defeat Blinds for base reward + $1/remaining hand + interest ($1 per $5 held, max $5 at $25)
- **Shop Reroll**: Starts at $5, increases $1 per reroll, resets when entering new shop
- **Buy Cost**: (base_cost + edition_cost) x discount_percent (min $1)
- **Sell Value**: floor(buy_cost / 2) (min $1)
- **Voucher Discounts**: Clearance Sale (25% off), Liquidation (50% off)
- **Credit Card Floor**: Rental Jokers charge $3/round; can go into debt

Source: https://balatrowiki.org/w/The_Shop, https://balatrowiki.org/w/Money

## Card Modifier Interactions

- **Eternal Sticker**: Cannot be sold or destroyed (Black Stake+, 30% chance)
- **Perishable Sticker**: Debuffed after 5 rounds (Orange Stake+, 30% chance); cannot coexist with Eternal
- **Rental Sticker**: Costs $1 to buy, charges $3/round (Gold Stake, 30% chance); can stack with Eternal/Perishable
- **Editions**: Foil (+50 chips), Holographic (+10 mult), Polychrome (x1.5 mult), Negative (+1 Joker slot)
- **Enhancements/Seals**: One per playing card; replaced if new one applied; Editions are permanent

Source: https://balatrowiki.org/w/Card_Modifiers, https://balatrowiki.org/w/Stickers

## Booster Pack Pick Counts

| Pack Type | Normal ($4) | Jumbo ($6) | Mega ($8) |
|-----------|-------------|------------|-----------|
| Arcana (Tarot) | Pick 1 of 3 | Pick 1 of 5 | Pick 2 of 5 |
| Celestial (Planet) | Pick 1 of 3 | Pick 1 of 5 | Pick 2 of 5 |
| Standard (Playing Cards) | Pick 1 of 3 | Pick 1 of 5 | Pick 2 of 5 |
| Buffoon (Jokers) | Pick 1 of 2 | Pick 1 of 4 | Pick 2 of 4 |
| Spectral | Pick 1 of 2 | Pick 1 of 4 | Pick 2 of 4 |

- **Shop Inventory**: 2 random cards + 2 Booster Packs + 1 Voucher (default)
- **Reroll Behavior**: Packs and Vouchers do NOT restock on reroll; only on new shop entry

Source: https://balatrowiki.org/w/Booster_Packs

## Stakes Summary

Stakes are cumulative difficulty modifiers (each adds to previous):

1. **White**: Base difficulty
2. **Red**: Small Blind gives no money
3. **Green**: Score requirement scales faster
4. **Black**: 30% Eternal Jokers (cannot sell/destroy)
5. **Blue**: -1 Discard
6. **Purple**: Score scales even faster
7. **Orange**: 30% Perishable Jokers (debuff after 5 rounds)
8. **Gold**: 30% Rental Jokers ($1 buy, $3/round cost)

Source: https://balatrowiki.org/w/Stakes

## Endless Mode

- **Activation**: After defeating Ante 8 Boss Blind, choose to continue
- **Scaling**: Score requirements increase exponentially (Ante 9: 110k base, Ante 10: 560k base, etc.)
- **Showdown Blinds**: Appear every 8 Antes (Ante 8, 16, 24, 32...)

Source: https://balatrowiki.org/w/Blinds_and_Antes

## Challenge Mode

- **Challenge Decks**: Pre-configured runs with special rules and restrictions
- **Examples**: Inflation (prices increase $1 per purchase), specific Joker/Voucher restrictions
- **Unlocks**: Completing challenges unlocks new Jokers, Decks, or other content

Source: https://balatrowiki.org/w/Balatro

---

## Attribution

Content summarized from Balatro Wiki (https://balatrowiki.org), licensed under CC BY-NC-SA 3.0.  
This reference is for AI agent use in the Balatro MCP Bridge project.

Original wiki pages:
- Gameplay Loop: https://balatrowiki.org/w/Gameplay_loop
- Poker Hands: https://balatrowiki.org/w/Poker_Hands
- The Shop: https://balatrowiki.org/w/The_Shop
- Money: https://balatrowiki.org/w/Money
- Booster Packs: https://balatrowiki.org/w/Booster_Packs
- Card Modifiers: https://balatrowiki.org/w/Card_Modifiers
- Stickers: https://balatrowiki.org/w/Stickers
- Stakes: https://balatrowiki.org/w/Stakes
- Blinds and Antes: https://balatrowiki.org/w/Blinds_and_Antes
