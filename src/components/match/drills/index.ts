// Registers the delivered match-version drills into MATCH_DRILLS. MatchGame imports this
// module for its side effect; any drill not registered here falls back to the existing sim
// mounted in matchMode, so the match always keeps playing.
import { MATCH_DRILLS } from '../matchDrill'
import { MatchDribbleDrill } from './MatchDribbleDrill'
import { MatchPassDrill } from './MatchPassDrill'
import { MatchHeaderDrill } from './MatchHeaderDrill'
import { MatchDefendDrill } from './MatchDefendDrill'
import { MatchGoalieDrill } from './MatchGoalieDrill'
import { MatchShootDrill } from './MatchShootDrill'

MATCH_DRILLS.dribble = MatchDribbleDrill
MATCH_DRILLS.pass = MatchPassDrill
MATCH_DRILLS.header = MatchHeaderDrill
MATCH_DRILLS.defend = MatchDefendDrill
MATCH_DRILLS.goalie = MatchGoalieDrill
MATCH_DRILLS.shoot = MatchShootDrill
