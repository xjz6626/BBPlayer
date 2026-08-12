import { Host, Switch } from '@expo/ui'
import { memo } from 'react'

import useResolvedColorScheme from '@/hooks/theme/useResolvedColorScheme'

type UniversalSwitchProps = {
	value: boolean
	onValueChange: (value: boolean) => void
	disabled?: boolean
	testID?: string
}

const UniversalSwitch = memo(function UniversalSwitch({
	disabled,
	onValueChange,
	testID,
	value,
}: UniversalSwitchProps) {
	const colorScheme = useResolvedColorScheme()

	return (
		<Host
			colorScheme={colorScheme}
			matchContents
		>
			<Switch
				disabled={disabled}
				onValueChange={onValueChange}
				testID={testID}
				value={value}
			/>
		</Host>
	)
})

export default UniversalSwitch
