import { Checkbox, Host } from '@expo/ui'
import { memo } from 'react'
import { View } from 'react-native'

import useResolvedColorScheme from '@/hooks/theme/useResolvedColorScheme'

type UniversalCheckboxProps = {
	status: 'checked' | 'unchecked' | 'indeterminate'
	onPress?: () => void
	disabled?: boolean
	testID?: string
}

const UniversalCheckbox = memo(function UniversalCheckbox({
	disabled,
	onPress,
	status,
	testID,
}: UniversalCheckboxProps) {
	const colorScheme = useResolvedColorScheme()
	const checkbox = (
		<Host
			colorScheme={colorScheme}
			matchContents
		>
			<Checkbox
				disabled={disabled}
				onValueChange={() => onPress?.()}
				testID={testID}
				value={status === 'checked'}
			/>
		</Host>
	)

	if (!onPress) {
		return <View pointerEvents='none'>{checkbox}</View>
	}

	return checkbox
})

export default UniversalCheckbox
