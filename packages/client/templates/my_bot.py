# my_bot.py: the starter bot and the transport's five hooks, as shipped. This is the file you edit.
# Run it: python3 python/blackmaria.py play --vs master --bot my_bot.py --trace
# The state's shape: StateMsg in blackmaria's types/protocol/src/types.d.ts, as dicts.
from blackmaria import StarterBot, trace_line


class Bot:
    def __init__(self):
        self.starter = StarterBot()

    def on_start(self, start):
        self.starter.on_start(start)

    def decide(self, state):
        return self.starter.decide(state)


# Called with every decoded packet from the server, before the transport handles it.
def onPacket(transport, packet):
    return True


# Called with every delta `STATE`.
def shouldResync(transport, delta):
    return False


# Called when a tick's deadline is half gone and its `STATE` hasn't arrived, with the last state and the moves sent since.
def predictState(transport, last_state, pending_moves):
    return None


# Called with each state.
def planMoves(transport, state):
    bot = transport.bot_for(state["match_id"])
    return bot.decide(state) if bot is not None else {"kind": "WAIT"}


# Called once per settled tick, with its trace record: `{ match, tick, state_ms, think_ms, sent_ms, status, margin_ms, resync, seq_gap }`.
def onTick(transport, record):
    if transport.trace:
        transport.out(trace_line(record))
