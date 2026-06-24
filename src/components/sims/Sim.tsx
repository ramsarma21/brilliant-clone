import type { SimKey } from '../../types'
import type { SimProps } from './types'
import { ProjectileSim } from './ProjectileSim'
import { BasketballSim } from './BasketballSim'
import { SoccerSim } from './SoccerSim'
import { MotionGraphSim } from './MotionGraphSim'
import { ForcesSim } from './ForcesSim'
import { EnergySim } from './EnergySim'
import { CircuitsSim } from './CircuitsSim'

type Props = SimProps & { sim: SimKey }

export function Sim({ sim, ...rest }: Props) {
  switch (sim) {
    case 'projectile':
      return <ProjectileSim {...rest} />
    case 'basketball':
      return <BasketballSim {...rest} />
    case 'soccer':
      return <SoccerSim {...rest} />
    case 'motion-graph':
      return <MotionGraphSim {...rest} />
    case 'forces':
      return <ForcesSim {...rest} />
    case 'energy':
      return <EnergySim {...rest} />
    case 'circuits':
      return <CircuitsSim {...rest} />
    default:
      return null
  }
}
