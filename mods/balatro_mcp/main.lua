local mod = SMODS.current_mod

SMODS.current_mod.description_loc_vars = function()
  return {
    background_colour = G.C.CLEAR,
    text_colour = G.C.WHITE,
  }
end

local bridge_state = assert(SMODS.load_file('src/state.lua'))()
local bridge_commands = assert(SMODS.load_file('src/commands.lua'))()
local bridge_actions = assert(SMODS.load_file('src/actions.lua'))()

bridge_actions.register_all(bridge_commands)

local BRIDGE_DIR = love.filesystem.getSaveDirectory() .. '/Mods/balatro_mcp/bridge'

bridge_commands.init()

local _original_love_update = love.update

function love.update(dt)
  if _original_love_update then
    _original_love_update(dt)
  end
  local wrote = bridge_state.update(BRIDGE_DIR)
  if wrote then
    bridge_commands.set_state_seq(bridge_state.get_seq())
  end
  bridge_commands.update(dt)
end

sendDebugMessage('Loaded Balatro MCP Dev Mod (bridge active)', mod.id)
