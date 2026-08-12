import { FlatList, StyleSheet, View } from 'react-native'
import { Avatar, Text, TouchableRipple, useTheme } from 'react-native-paper'

import ActivityIndicator from '@/components/common/ActivityIndicator'
import type { BilibiliFollowingUser } from '@/types/apis/bilibili'
import { resolveBilibiliImageUrl } from '@/utils/imageUrl'

interface FollowingSelectorProps {
	users: BilibiliFollowingUser[]
	selectedMid?: number
	isFetchingNextPage: boolean
	hasNextPage: boolean
	onSelect: (mid?: number) => void
	onEndReached: () => void
}

export default function FollowingSelector({
	users,
	selectedMid,
	isFetchingNextPage,
	hasNextPage,
	onSelect,
	onEndReached,
}: FollowingSelectorProps) {
	const { colors } = useTheme()

	return (
		<View
			style={[styles.container, { borderBottomColor: colors.outlineVariant }]}
		>
			<FlatList
				horizontal
				data={users}
				keyExtractor={(item) => item.mid.toString()}
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.content}
				ListHeaderComponent={
					<TouchableRipple
						onPress={() => onSelect(undefined)}
						borderless
						style={[
							styles.userButton,
							selectedMid === undefined && {
								backgroundColor: colors.primaryContainer,
							},
						]}
					>
						<View style={styles.userContent}>
							<Avatar.Icon
								size={42}
								icon='apps'
								style={{
									backgroundColor:
										selectedMid === undefined
											? colors.primary
											: colors.secondaryContainer,
								}}
							/>
							<Text
								variant='labelSmall'
								numberOfLines={1}
								style={styles.name}
							>
								全部
							</Text>
						</View>
					</TouchableRipple>
				}
				renderItem={({ item }) => {
					const selected = item.mid === selectedMid
					return (
						<TouchableRipple
							onPress={() => onSelect(item.mid)}
							borderless
							style={[
								styles.userButton,
								selected && { backgroundColor: colors.primaryContainer },
							]}
						>
							<View style={styles.userContent}>
								<Avatar.Image
									size={42}
									source={{
										uri: resolveBilibiliImageUrl(item.face, 160) ?? '',
									}}
								/>
								<Text
									variant='labelSmall'
									numberOfLines={1}
									style={styles.name}
								>
									{item.uname}
								</Text>
							</View>
						</TouchableRipple>
					)
				}}
				onEndReached={() => {
					if (hasNextPage && !isFetchingNextPage) onEndReached()
				}}
				onEndReachedThreshold={0.5}
				ListFooterComponent={
					isFetchingNextPage ? (
						<View style={styles.loading}>
							<ActivityIndicator size='small' />
						</View>
					) : null
				}
			/>
		</View>
	)
}

const styles = StyleSheet.create({
	container: {
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	content: {
		paddingHorizontal: 10,
		paddingVertical: 8,
		gap: 6,
	},
	userButton: {
		width: 66,
		borderRadius: 12,
	},
	userContent: {
		alignItems: 'center',
		gap: 4,
		paddingVertical: 4,
	},
	name: {
		width: 60,
		textAlign: 'center',
	},
	loading: {
		width: 48,
		alignItems: 'center',
		justifyContent: 'center',
	},
})
