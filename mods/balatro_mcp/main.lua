local mod = SMODS.current_mod
local mod_path = mod.path

SMODS.current_mod.description_loc_vars = function()
  return {
    background_colour = G.C.CLEAR,
    text_colour = G.C.WHITE,
  }
end

local bridge_state = assert(load(NFS.read(mod_path .. 'src/state.lua'),
  ('=[SMODS %s "src/state.lua"]'):format(mod.id)))()

local BRIDGE_DIR = love.filesystem.getSaveDirectory() .. '/Mods/balatro_mcp/bridge'

local _original_love_update = love.update

function love.update(dt)
  if _original_love_update then
    _original_love_update(dt)
  end
  bridge_state.update(BRIDGE_DIR)
end

sendDebugMessage('Loaded Balatro MCP Dev Mod (bridge active)', mod.id)
