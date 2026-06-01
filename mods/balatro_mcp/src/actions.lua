--- actions.lua — Action dispatcher for the Balatro MCP bridge.
-- Maps each command kind to the correct Balatro G.FUNCS call with phase guards
-- and sticker rules. Defense-in-depth: re-checks G.STATE before every action.

local Actions = {}

--- Registry of action handlers
local handlers = {}

--- Phase constants (resolved lazily from G.STATES)
local function S(name, fallback)
  return (G and G.STATES and G.STATES[name]) or fallback
end

---------------------------------------------------------------------------
-- Utility: error/success response builders
---------------------------------------------------------------------------

local function err(error_code, message)
  return { ok = false, error_code = error_code, error_message = message, message = message }
end

local function ok(data)
  return { ok = true, data = data or {} }
end

local function mark_busy(seconds)
  if not (love and love.timer and love.timer.getTime) then return end
  local until_time = love.timer.getTime() + seconds
  _G.BALATRO_MCP_BUSY_UNTIL = math.max(_G.BALATRO_MCP_BUSY_UNTIL or 0, until_time)
end

---------------------------------------------------------------------------
-- Phase guard: check G.STATE against allowed states
---------------------------------------------------------------------------

local function check_phase(allowed_states)
  if not G or not G.STATE then
    return err("WRONG_PHASE", "Game state not available")
  end
  for _, state in ipairs(allowed_states) do
    if G.STATE == state then
      return nil -- pass
    end
  end
  return err("WRONG_PHASE", "Action not allowed in current phase (G.STATE=" .. tostring(G.STATE) .. ")")
end

---------------------------------------------------------------------------
-- Card resolution helpers
---------------------------------------------------------------------------

local function card_id_key(card_id)
  if card_id == nil then return nil end
  return tostring(card_id)
end

local function find_card_in(area, card_id)
  if not area or not area.cards then return nil end
  local wanted = card_id_key(card_id)
  for _, card in ipairs(area.cards) do
    local cid = card.sort_id or (card.config and card.config.card_id)
    if cid == card_id or card_id_key(cid) == wanted then
      return card
    end
  end
  return nil
end

local function find_card_in_hand(card_id)
  return find_card_in(G.hand, card_id)
end

local function find_card_in_jokers(card_id)
  return find_card_in(G.jokers, card_id)
end

local function find_card_in_consumables(card_id)
  return find_card_in(G.consumeables, card_id)
end

local function find_card_in_shop(card_id)
  local card = find_card_in(G.shop_jokers, card_id)
  if card then return card, "joker" end
  card = find_card_in(G.shop_vouchers, card_id)
  if card then return card, "voucher" end
  card = find_card_in(G.shop_booster, card_id)
  if card then return card, "booster" end
  return nil, nil
end

local function find_card_in_pack(card_id)
  return find_card_in(G.pack_cards, card_id)
end

---------------------------------------------------------------------------
-- Sticker checks
---------------------------------------------------------------------------

local function has_eternal(card)
  return card and card.ability and card.ability.eternal
end

---------------------------------------------------------------------------
-- Funds check
---------------------------------------------------------------------------

local function available_funds()
  if not G or not G.GAME then return 0 end
  return (G.GAME.dollars or 0) - (G.GAME.bankrupt_at or 0)
end

---------------------------------------------------------------------------
-- Pack states helper
---------------------------------------------------------------------------

local function get_pack_states()
  local states = {}
  if S("TAROT_PACK") then states[#states + 1] = S("TAROT_PACK") end
  if S("PLANET_PACK") then states[#states + 1] = S("PLANET_PACK") end
  if S("SPECTRAL_PACK") then states[#states + 1] = S("SPECTRAL_PACK") end
  if S("STANDARD_PACK") then states[#states + 1] = S("STANDARD_PACK") end
  if S("BUFFOON_PACK") then states[#states + 1] = S("BUFFOON_PACK") end
  if S("SMODS_BOOSTER_OPENED") then states[#states + 1] = S("SMODS_BOOSTER_OPENED") end
  return states
end

local function is_pack_state()
  if not G or not G.STATE then return false end
  local pack_states = get_pack_states()
  for _, ps in ipairs(pack_states) do
    if G.STATE == ps then return true end
  end
  return false
end

local DECK_ENUM_TO_NAME = {
  RED = "Red Deck",
  BLUE = "Blue Deck",
  YELLOW = "Yellow Deck",
  GREEN = "Green Deck",
  BLACK = "Black Deck",
  MAGIC = "Magic Deck",
  NEBULA = "Nebula Deck",
  GHOST = "Ghost Deck",
  ABANDONED = "Abandoned Deck",
  CHECKERED = "Checkered Deck",
  ZODIAC = "Zodiac Deck",
  PAINTED = "Painted Deck",
  ANAGLYPH = "Anaglyph Deck",
  PLASMA = "Plasma Deck",
  ERRATIC = "Erratic Deck",
}

local STAKE_ENUM_TO_NUMBER = {
  WHITE = 1,
  RED = 2,
  GREEN = 3,
  BLACK = 4,
  BLUE = 5,
  PURPLE = 6,
  ORANGE = 7,
  GOLD = 8,
}

local function normalize_blind_slot(slot)
  if slot == nil or slot == "" or slot == "current" then
    slot = G and G.GAME and G.GAME.blind_on_deck
  end
  if type(slot) ~= "string" then return nil end
  slot = string.lower(slot)
  if slot == "small" or slot == "big" or slot == "boss" then return slot end
  return nil
end

local function get_blind_key(slot)
  return slot == "small" and "Small" or slot == "big" and "Big" or "Boss"
end

local function get_target_card_ids(args)
  if args.target_card_ids and type(args.target_card_ids) == "table" then
    return args.target_card_ids
  end
  if args.targets and type(args.targets) == "table" then
    return args.targets
  end
  return nil
end

local function highlight_target_cards(target_card_ids)
  if not target_card_ids or #target_card_ids == 0 then return nil end
  if G.hand and G.hand.unhighlight_all then
    G.hand:unhighlight_all()
  end
  for _, tid in ipairs(target_card_ids) do
    local target = find_card_in_hand(tid)
    if not target then
      return err("INVALID_TARGET", "Target card not found in hand: " .. tostring(tid))
    end
    if G.hand and G.hand.add_to_highlighted then
      G.hand:add_to_highlighted(target)
    end
  end
  return nil
end

---------------------------------------------------------------------------
-- ACTION: start_run
---------------------------------------------------------------------------

handlers.start_run = function(args)
  local phase_err = check_phase({ S("MENU", 1) })
  if phase_err then return phase_err end

  local deck = args.deck or "RED"
  local stake = args.stake or "WHITE"
  local deck_name = DECK_ENUM_TO_NAME[deck]
  local stake_number = STAKE_ENUM_TO_NUMBER[stake]

  if not deck_name then
    return err("INVALID_TARGET", "Invalid deck: " .. tostring(deck))
  end
  if not stake_number then
    return err("INVALID_TARGET", "Invalid stake: " .. tostring(stake))
  end
  if not G.FUNCS or not G.FUNCS.setup_run or not G.FUNCS.start_run then
    return err("WRONG_PHASE", "Run setup functions are not available")
  end

  G.FUNCS.setup_run({ config = {} })
  if G.FUNCS.exit_overlay_menu then
    G.FUNCS.exit_overlay_menu()
  end

  local deck_found = false
  if G.P_CENTER_POOLS and G.P_CENTER_POOLS.Back then
    for _, deck_data in pairs(G.P_CENTER_POOLS.Back) do
      if deck_data.name == deck_name then
        if G.GAME and G.GAME.selected_back and G.GAME.selected_back.change_to then
          G.GAME.selected_back:change_to(deck_data)
        end
        if G.GAME and G.GAME.viewed_back and G.GAME.viewed_back.change_to then
          G.GAME.viewed_back:change_to(deck_data)
        end
        deck_found = true
        break
      end
    end
  end

  if not deck_found then
    return err("INVALID_TARGET", "Deck not found: " .. deck_name)
  end

  local run_params = { stake = stake_number }
  if args.seed and args.seed ~= "" then
    run_params.seed = args.seed
  end

  G.FUNCS.start_run(nil, run_params)
  return ok({ deck = deck, stake = stake, seed = args.seed })
end

---------------------------------------------------------------------------
-- ACTION: return_to_menu
---------------------------------------------------------------------------

handlers.return_to_menu = function(args)
  if G and G.STATE == S("MENU", 1) then
    return ok({ already_menu = true })
  end

  if G.FUNCS and G.FUNCS.go_to_menu then
    G.FUNCS.go_to_menu({})
    return ok({ returning_to_menu = true })
  end

  return err("WRONG_PHASE", "go_to_menu is not available")
end

---------------------------------------------------------------------------
-- ACTION: select_blind
---------------------------------------------------------------------------

handlers.select_blind = function(args)
  local phase_err = check_phase({ S("BLIND_SELECT") })
  if phase_err then return phase_err end

  local slot = normalize_blind_slot(args.slot)
  if not slot then
    return err("INVALID_TARGET", "Invalid blind slot: " .. tostring(slot))
  end

  -- Verify blind choice exists
  if not G.GAME or not G.GAME.round_resets or not G.GAME.round_resets.blind_choices then
    return err("INVALID_TARGET", "No blind choices available")
  end

  local blind_key = get_blind_key(slot)
  if not G.GAME.round_resets.blind_choices[blind_key] then
    return err("INVALID_TARGET", "Blind slot '" .. slot .. "' not available in current choices")
  end

  if G.FUNCS and G.FUNCS.select_blind then
    local blind_pane = G.blind_select_opts and G.blind_select_opts[slot]
    local select_button = blind_pane and blind_pane.get_UIE_by_ID and blind_pane:get_UIE_by_ID("select_blind_button")
    G.FUNCS.select_blind(select_button or { config = { id = slot } })
    mark_busy(1.0)
  end

  return ok({ blind_selected = slot })
end

---------------------------------------------------------------------------
-- ACTION: skip_blind
---------------------------------------------------------------------------

handlers.skip_blind = function(args)
  local phase_err = check_phase({ S("BLIND_SELECT") })
  if phase_err then return phase_err end

  local slot = normalize_blind_slot(args.slot)
  if not slot then
    return err("INVALID_TARGET", "Invalid blind slot: " .. tostring(args.slot))
  end
  if slot == "boss" then
    return err("INVALID_TARGET", "Boss blind cannot be skipped")
  end

  if G.FUNCS and G.FUNCS.skip_blind then
    local blind_key = get_blind_key(slot)
    local blind_pane = G.blind_select_opts and G.blind_select_opts[slot]
    local tag_element = blind_pane and blind_pane.get_UIE_by_ID and blind_pane:get_UIE_by_ID("tag_" .. blind_key)
    local skip_button = tag_element and tag_element.children and tag_element.children[2]
    G.FUNCS.skip_blind(skip_button)
    mark_busy(1.0)
  end

  return ok({ skipped = true, blind_skipped = slot })
end

---------------------------------------------------------------------------
-- ACTION: select_hand_cards
---------------------------------------------------------------------------

handlers.select_hand_cards = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND") })
  if phase_err then return phase_err end

  local card_ids = args.card_ids
  if not card_ids or type(card_ids) ~= "table" then
    return err("INVALID_TARGET", "card_ids must be an array")
  end

  -- Validate count
  local limit = (G.hand and G.hand.config and G.hand.config.highlighted_limit) or 5
  if #card_ids > limit then
    return err("INVALID_TARGET", "Cannot select more than " .. tostring(limit) .. " cards")
  end

  -- Resolve all cards first
  local cards_to_select = {}
  for _, cid in ipairs(card_ids) do
    local card = find_card_in_hand(cid)
    if not card then
      return err("INVALID_TARGET", "Card not found in hand: " .. tostring(cid))
    end
    cards_to_select[#cards_to_select + 1] = card
  end

  -- Unhighlight all current selections
  if G.hand and G.hand.unhighlight_all then
    G.hand:unhighlight_all()
  elseif G.hand and G.hand.highlighted then
    -- Manual fallback
    for i = #G.hand.highlighted, 1, -1 do
      local c = G.hand.highlighted[i]
      if c and c.unhighlight then c:unhighlight() end
    end
  end

  -- Highlight requested cards
  for _, card in ipairs(cards_to_select) do
    if G.hand and G.hand.add_to_highlighted then
      G.hand:add_to_highlighted(card)
    elseif card.highlight then
      card:highlight(true)
    end
  end

  return ok({ selected_count = #cards_to_select })
end

---------------------------------------------------------------------------
-- ACTION: sort_hand
---------------------------------------------------------------------------

handlers.sort_hand = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND") })
  if phase_err then return phase_err end

  if args.order and type(args.order) == "table" then
    if not G.hand or not G.hand.cards then
      return err("INVALID_TARGET", "No hand cards to sort")
    end
    if #args.order ~= #G.hand.cards then
      return err("INVALID_TARGET", "order count (" .. #args.order .. ") does not match hand count (" .. #G.hand.cards .. ")")
    end

    local id_to_card = {}
    for _, card in ipairs(G.hand.cards) do
      local cid = card.sort_id or (card.config and card.config.card_id)
      id_to_card[card_id_key(cid)] = card
    end

    local seen = {}
    local new_order = {}
    for _, cid in ipairs(args.order) do
      local key = card_id_key(cid)
      local card = id_to_card[key]
      if not card then
        return err("INVALID_TARGET", "Card not found in hand: " .. tostring(cid))
      end
      if seen[key] then
        return err("INVALID_TARGET", "Duplicate card ID in order: " .. tostring(cid))
      end
      seen[key] = true
      new_order[#new_order + 1] = card
    end

    G.hand.cards = new_order
    if G.hand.set_ranks then
      G.hand:set_ranks()
    end
    return ok({ sorted_by = "order", count = #new_order })
  end

  local by = args.by
  if by ~= "rank" and by ~= "suit" then
    return err("INVALID_TARGET", "Sort criterion must be 'rank' or 'suit', got: " .. tostring(by))
  end

  if by == "rank" then
    if G.FUNCS and G.FUNCS.sort_hand_value then
      G.FUNCS.sort_hand_value()
    end
  else
    if G.FUNCS and G.FUNCS.sort_hand_suit then
      G.FUNCS.sort_hand_suit()
    end
  end

  return ok({ sorted_by = by })
end

---------------------------------------------------------------------------
-- ACTION: play_hand
---------------------------------------------------------------------------

handlers.play_hand = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND") })
  if phase_err then return phase_err end

  -- Check cards are highlighted
  if not G.hand or not G.hand.highlighted or #G.hand.highlighted == 0 then
    return err("INVALID_TARGET", "No cards selected to play")
  end
  if #G.hand.highlighted > 5 then
    return err("INVALID_TARGET", "More than 5 cards selected")
  end

  -- Check hands remaining
  local hands_left = G.GAME and G.GAME.current_round and G.GAME.current_round.hands_left or 0
  if hands_left <= 0 then
    return err("INVALID_TARGET", "No hands remaining")
  end

  -- Check boss blind block_play
  if G.GAME and G.GAME.blind and G.GAME.blind.block_play then
    return err("INVALID_TARGET", "Boss blind is blocking play")
  end

  if G.FUNCS and G.FUNCS.play_cards_from_highlighted then
    G.FUNCS.play_cards_from_highlighted()
    mark_busy(2.0)
  end

  return ok({ cards_played = #G.hand.highlighted })
end

---------------------------------------------------------------------------
-- ACTION: discard_hand
---------------------------------------------------------------------------

handlers.discard_hand = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND") })
  if phase_err then return phase_err end

  -- Check cards are highlighted
  if not G.hand or not G.hand.highlighted or #G.hand.highlighted == 0 then
    return err("INVALID_TARGET", "No cards selected to discard")
  end
  if #G.hand.highlighted > 5 then
    return err("INVALID_TARGET", "More than 5 cards selected")
  end

  -- Check discards remaining
  local discards_left = G.GAME and G.GAME.current_round and G.GAME.current_round.discards_left or 0
  if discards_left <= 0 then
    return err("INVALID_TARGET", "No discards remaining")
  end

  if G.FUNCS and G.FUNCS.discard_cards_from_highlighted then
    G.FUNCS.discard_cards_from_highlighted()
    mark_busy(1.0)
  end

  return ok({ cards_discarded = #G.hand.highlighted })
end

---------------------------------------------------------------------------
-- ACTION: use_consumable
---------------------------------------------------------------------------

handlers.use_consumable = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND"), S("SHOP") })
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  local card = find_card_in_consumables(card_id)
  if not card then
    return err("INVALID_TARGET", "Consumable not found: " .. tostring(card_id))
  end

  local target_err = highlight_target_cards(get_target_card_ids(args))
  if target_err then return target_err end

  -- Check can_use_consumeable after applying target highlights.
  if card.can_use_consumeable and not card:can_use_consumeable() then
    return err("INVALID_TARGET", "Consumable cannot be used in current context; target cards may be required")
  end

  -- Use the consumable
  if G.FUNCS and G.FUNCS.use_card then
    G.FUNCS.use_card({ config = { ref_table = card } })
    mark_busy(1.0)
  end

  return ok({ used = card_id })
end

---------------------------------------------------------------------------
-- ACTION: sell_card
---------------------------------------------------------------------------

handlers.sell_card = function(args)
  local phase_err = check_phase({ S("SHOP") })
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  -- Find card in jokers or consumables
  local card = find_card_in_jokers(card_id)
  if not card then
    card = find_card_in_consumables(card_id)
  end
  if not card then
    return err("INVALID_TARGET", "Card not found in jokers or consumables: " .. tostring(card_id))
  end

  -- Sticker guard: Eternal blocks sell
  if has_eternal(card) then
    return err("ETERNAL_BLOCKED", "Card has Eternal sticker and cannot be sold")
  end

  -- Sell the card
  if G.FUNCS and G.FUNCS.sell_card then
    G.FUNCS.sell_card({ config = { ref_table = card } })
    mark_busy(0.4)
  end

  return ok({ sold = card_id, sell_value = card.sell_cost })
end

---------------------------------------------------------------------------
-- ACTION: buy_card
---------------------------------------------------------------------------

handlers.buy_card = function(args)
  local phase_err = check_phase({ S("SHOP") })
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  local card, shop_area = find_card_in_shop(card_id)
  if not card then
    return err("INVALID_TARGET", "Card not found in shop: " .. tostring(card_id))
  end

  -- Check funds
  local cost = card.cost or 0
  if cost > available_funds() then
    return err("INSUFFICIENT_FUNDS", "Cannot afford card (cost=" .. tostring(cost) .. ", available=" .. tostring(available_funds()) .. ")")
  end

  -- Check slots for jokers
  if shop_area == "joker" then
    local joker_count = G.jokers and G.jokers.cards and #G.jokers.cards or 0
    local joker_limit = G.jokers and G.jokers.config and G.jokers.config.card_limit or 5
    if joker_count >= joker_limit then
      return err("SLOTS_FULL", "No available joker slots")
    end
  end

  -- Check slots for consumables (if it's a consumable in shop_jokers area)
  if card.config and card.config.center then
    local set = card.config.center.set
    if set == "Tarot" or set == "Planet" or set == "Spectral" then
      local cons_count = G.consumeables and G.consumeables.cards and #G.consumeables.cards or 0
      local cons_limit = G.consumeables and G.consumeables.config and G.consumeables.config.card_limit or 2
      if cons_count >= cons_limit then
        return err("SLOTS_FULL", "No available consumable slots")
      end
    end
  end

  -- Voucher dependency check
  local voucher_key = nil
  if shop_area == "voucher" and card.config and card.config.center then
    local center = card.config.center
    if center.set ~= "Voucher" then
      return err("INVALID_TARGET", "Card in voucher area is not a Voucher: " .. tostring(center.set))
    end
    voucher_key = center.key
    if center.requires and G.GAME and G.GAME.used_vouchers then
      -- Check each required voucher
      local reqs = type(center.requires) == "table" and center.requires or { center.requires }
      for _, req in ipairs(reqs) do
        if not G.GAME.used_vouchers[req] then
          return err("VOUCHER_DEPENDENCY", "Requires voucher not yet purchased: " .. tostring(req))
        end
      end
    end
  end

  -- Buy/redeem the card. Balatro vouchers use the redeem/use path, not the
  -- normal buy path; buy_from_shop routes non-consumables into G.jokers.
  if shop_area == "voucher" then
    if not G.FUNCS or not G.FUNCS.use_card then
      return err("INTERNAL_ERROR", "Balatro use_card callback is unavailable")
    end
    G.FUNCS.use_card({ config = { ref_table = card } })
    mark_busy(0.7)
    if voucher_key and G.GAME and G.GAME.used_vouchers and not G.GAME.used_vouchers[voucher_key] then
      return err("INTERNAL_ERROR", "Voucher was not redeemed: " .. tostring(voucher_key))
    end
  elseif G.FUNCS and G.FUNCS.buy_from_shop then
    G.FUNCS.buy_from_shop({ config = { ref_table = card } })
    mark_busy(0.5)
  end

  return ok({ bought = card_id, cost = cost, shop_area = shop_area, voucher_key = voucher_key })
end

---------------------------------------------------------------------------
-- ACTION: buy_and_use_card
---------------------------------------------------------------------------

handlers.buy_and_use_card = function(args)
  local phase_err = check_phase({ S("SHOP") })
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  local card, shop_area = find_card_in_shop(card_id)
  if not card then
    return err("INVALID_TARGET", "Card not found in shop: " .. tostring(card_id))
  end

  -- Must be a consumable
  if not card.config or not card.config.center then
    return err("INVALID_TARGET", "Card is not a consumable")
  end
  local set = card.config.center.set
  if set ~= "Tarot" and set ~= "Planet" and set ~= "Spectral" then
    return err("INVALID_TARGET", "Only consumables (Tarot/Planet/Spectral) can be bought and used immediately")
  end

  -- Check funds
  local cost = card.cost or 0
  if cost > available_funds() then
    return err("INSUFFICIENT_FUNDS", "Cannot afford card (cost=" .. tostring(cost) .. ", available=" .. tostring(available_funds()) .. ")")
  end

  local target_err = highlight_target_cards(get_target_card_ids(args))
  if target_err then return target_err end

  -- Check can_use after applying target highlights.
  if card.can_use_consumeable and not card:can_use_consumeable() then
    return err("INVALID_TARGET", "Consumable cannot be used in current context; target cards may be required")
  end

  -- Let Balatro's native buy-and-use path run use_card after the delayed
  -- purchase event removes the card from its shop area. Calling use_card
  -- immediately here races that event and can leave c1.area nil.
  if G.FUNCS and G.FUNCS.buy_from_shop then
    G.FUNCS.buy_from_shop({ config = { ref_table = card, id = "buy_and_use" } })
    mark_busy(1.0)
  end

  return ok({ bought_and_used = card_id, cost = cost })
end

---------------------------------------------------------------------------
-- ACTION: reroll_shop
---------------------------------------------------------------------------

handlers.reroll_shop = function(args)
  local phase_err = check_phase({ S("SHOP"), S("BLIND_SELECT") })
  if phase_err then return phase_err end

  -- Boss reroll guard: in BLIND_SELECT, require Retcon voucher
  if G.STATE == S("BLIND_SELECT") then
    if not G.GAME or not G.GAME.used_vouchers or not G.GAME.used_vouchers.v_retcon then
      return err("BOSS_REROLL_LOCKED", "Boss blind reroll requires Retcon voucher")
    end
  end

  -- Check funds (unless free rerolls available)
  local free_rerolls = G.GAME and G.GAME.current_round and G.GAME.current_round.free_rerolls or 0
  if free_rerolls <= 0 then
    local reroll_cost = G.GAME and G.GAME.current_round and G.GAME.current_round.reroll_cost or 5
    if reroll_cost > available_funds() then
      return err("INSUFFICIENT_FUNDS", "Cannot afford reroll (cost=" .. tostring(reroll_cost) .. ", available=" .. tostring(available_funds()) .. ")")
    end
  end

  if G.FUNCS and G.FUNCS.reroll_shop then
    G.FUNCS.reroll_shop()
    mark_busy(0.5)
  end

  return ok({ rerolled = true })
end

---------------------------------------------------------------------------
-- ACTION: leave_shop
---------------------------------------------------------------------------

handlers.leave_shop = function(args)
  local phase_err = check_phase({ S("SHOP") })
  if phase_err then return phase_err end

  if G.FUNCS and G.FUNCS.toggle_shop then
    G.FUNCS.toggle_shop()
    mark_busy(1.0)
  end

  return ok({ left_shop = true })
end

---------------------------------------------------------------------------
-- ACTION: cash_out
---------------------------------------------------------------------------

handlers.cash_out = function(args)
  local phase_err = check_phase({ S("ROUND_EVAL") })
  if phase_err then return phase_err end

  if G.GAME and G.GAME.won and G.OVERLAY_MENU and G.FUNCS and G.FUNCS.exit_overlay_menu then
    G.FUNCS.exit_overlay_menu()
    mark_busy(1.0)
    return ok({ continued_endless = true })
  end

  if G.FUNCS and G.FUNCS.cash_out then
    G.FUNCS.cash_out({ config = {} })
    mark_busy(1.0)
  end

  return ok({ cashed_out = true })
end

---------------------------------------------------------------------------
-- ACTION: open_booster
---------------------------------------------------------------------------

handlers.open_booster = function(args)
  local phase_err = check_phase({ S("SHOP") })
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  local card = find_card_in(G.shop_booster, card_id)
  if not card then
    return err("INVALID_TARGET", "Booster not found in shop: " .. tostring(card_id))
  end

  -- Check funds
  local cost = card.cost or 0
  if cost > available_funds() then
    return err("INSUFFICIENT_FUNDS", "Cannot afford booster (cost=" .. tostring(cost) .. ", available=" .. tostring(available_funds()) .. ")")
  end

  -- Open the booster (buy + open)
  if G.FUNCS and G.FUNCS.use_card then
    local target_err = highlight_target_cards(get_target_card_ids(args))
    if target_err then return target_err end
    G.FUNCS.use_card({ config = { ref_table = card } })
    mark_busy(2.0)
  end

  return ok({ opened = card_id })
end

---------------------------------------------------------------------------
-- ACTION: select_booster_card
---------------------------------------------------------------------------

handlers.select_booster_card = function(args)
  local pack_states = get_pack_states()
  local phase_err = check_phase(pack_states)
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  -- Check picks remaining
  local picks_remaining = G.GAME and G.GAME.pack_choices or 0
  if picks_remaining <= 0 then
    return err("PACK_LIMIT_REACHED", "All picks from booster pack already used")
  end

  -- Find card in pack
  local card = find_card_in_pack(card_id)
  if not card then
    return err("INVALID_TARGET", "Card not found in pack: " .. tostring(card_id))
  end

  -- Check destination slots
  if card.config and card.config.center then
    local set = card.config.center.set
    if set == "Joker" then
      local joker_count = G.jokers and G.jokers.cards and #G.jokers.cards or 0
      local joker_limit = G.jokers and G.jokers.config and G.jokers.config.card_limit or 5
      if joker_count >= joker_limit then
        return err("SLOTS_FULL", "No available joker slots")
      end
    elseif set == "Tarot" or set == "Planet" or set == "Spectral" then
      local cons_count = G.consumeables and G.consumeables.cards and #G.consumeables.cards or 0
      local cons_limit = G.consumeables and G.consumeables.config and G.consumeables.config.card_limit or 2
      if cons_count >= cons_limit then
        return err("SLOTS_FULL", "No available consumable slots")
      end
    end
  end

  local target_err = highlight_target_cards(get_target_card_ids(args))
  if target_err then return target_err end

  if card.can_use_consumeable and not card:can_use_consumeable() then
    return err("INVALID_TARGET", "Pack card cannot be selected in current context; target cards may be required")
  end

  -- Select the card from the pack
  if G.FUNCS and G.FUNCS.use_card then
    G.FUNCS.use_card({ config = { ref_table = card } })
    mark_busy(1.0)
  end

  return ok({ selected = card_id })
end

---------------------------------------------------------------------------
-- ACTION: skip_booster
---------------------------------------------------------------------------

handlers.skip_booster = function(args)
  local pack_states = get_pack_states()
  local phase_err = check_phase(pack_states)
  if phase_err then return phase_err end

  if G.FUNCS and G.FUNCS.skip_booster then
    G.FUNCS.skip_booster()
    mark_busy(1.0)
  end

  return ok({ skipped_booster = true })
end

---------------------------------------------------------------------------
-- ACTION: reorder_jokers
---------------------------------------------------------------------------

handlers.reorder_jokers = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND"), S("SHOP") })
  if phase_err then return phase_err end

  local card_ids = args.card_ids
  if not card_ids or type(card_ids) ~= "table" then
    return err("INVALID_TARGET", "card_ids must be an array")
  end

  -- Validate permutation: must be exact same set as current jokers
  if not G.jokers or not G.jokers.cards then
    return err("INVALID_TARGET", "No jokers to reorder")
  end

  local current_count = #G.jokers.cards
  if #card_ids ~= current_count then
    return err("INVALID_TARGET", "card_ids count (" .. #card_ids .. ") does not match joker count (" .. current_count .. ")")
  end

  -- Build lookup of current joker IDs
  local current_ids = {}
  local id_to_card = {}
  for _, card in ipairs(G.jokers.cards) do
    local cid = card.sort_id or (card.config and card.config.card_id)
    local key = card_id_key(cid)
    current_ids[key] = true
    id_to_card[key] = card
  end

  -- Validate all provided IDs exist and are unique
  local seen = {}
  for _, cid in ipairs(card_ids) do
    local key = card_id_key(cid)
    if not current_ids[key] then
      return err("INVALID_TARGET", "Joker ID not found: " .. tostring(cid))
    end
    if seen[key] then
      return err("INVALID_TARGET", "Duplicate joker ID in reorder: " .. tostring(cid))
    end
    seen[key] = true
  end

  -- Reorder: rebuild G.jokers.cards in the requested order
  local new_order = {}
  for _, cid in ipairs(card_ids) do
    new_order[#new_order + 1] = id_to_card[card_id_key(cid)]
  end
  G.jokers.cards = new_order

  -- Update ranks if method available
  if G.jokers.set_ranks then
    G.jokers:set_ranks()
  end

  return ok({ reordered = true, count = current_count })
end

---------------------------------------------------------------------------
-- Public API
---------------------------------------------------------------------------

--- Register a single action handler
function Actions.register_action(kind, handler)
  handlers[kind] = handler
end

--- Dispatch an action by kind. Wraps in pcall for safety.
--- @param kind string The action kind
--- @param args table The action arguments
--- @return table Result with ok, error_code, message, data fields
function Actions.dispatch(kind, args)
  local handler = handlers[kind]
  if not handler then
    return err("INTERNAL_ERROR", "Unknown action kind: " .. tostring(kind))
  end

  local success, result = pcall(handler, args or {})
  if not success then
    return err("INTERNAL_ERROR", "Action '" .. tostring(kind) .. "' raised error: " .. tostring(result))
  end

  if type(result) ~= "table" then
    return ok()
  end

  return result
end

--- Register all built-in handlers with a Commands module
--- @param commands table The Commands module with register_action method
function Actions.register_all(commands)
  for kind, handler in pairs(handlers) do
    commands.register_action(kind, function(args)
      return Actions.dispatch(kind, args)
    end)
  end
end

--- Get list of registered action kinds (for debugging)
function Actions.list_kinds()
  local kinds = {}
  for kind, _ in pairs(handlers) do
    kinds[#kinds + 1] = kind
  end
  table.sort(kinds)
  return kinds
end

return Actions
