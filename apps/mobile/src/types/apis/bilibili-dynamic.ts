/**
 * 关注列表中的用户。
 */
export interface BilibiliFollowingUser {
	mid: number
	uname: string
	face: string
	sign?: string
}

/**
 * 当前账号的关注列表。
 */
export interface BilibiliFollowingList {
	list: BilibiliFollowingUser[] | null
	total: number
}

export interface BilibiliDynamicAuthor {
	face: string
	following: boolean | null
	jump_url: string
	mid: number
	name: string
	pub_action: string
	pub_location_text: string
	pub_time: string
	pub_ts: number
}

export interface BilibiliDynamicArchive {
	aid: string
	bvid: string
	cover: string
	desc: string
	duration_text: string
	jump_url: string
	stat: {
		danmaku: string
		play: string
	}
	title: string
	type: number
}

export interface BilibiliDynamicStat {
	comment: {
		count: number
		forbidden: boolean
		hidden?: boolean
	}
	forward: {
		count: number
		forbidden: boolean
	}
	like: {
		count: number
		forbidden: boolean
		status: boolean
	}
}

export interface BilibiliDynamicItem {
	id_str: string
	modules: {
		module_author: BilibiliDynamicAuthor
		module_dynamic: {
			desc?: {
				text: string
			}
			major?: {
				type: string
				archive?: BilibiliDynamicArchive
				opus?: {
					summary: {
						text: string
					}
					title: string | null
				}
			}
		}
		module_stat?: BilibiliDynamicStat
	}
	type: string
	visible: boolean
	orig?: BilibiliDynamicItem
}

/**
 * B 站视频动态流。offset 是下一页游标。
 */
export interface BilibiliDynamicFeed {
	has_more: boolean
	items: BilibiliDynamicItem[]
	offset: string
	update_baseline: string
	update_num: number
}

export interface BilibiliDynamicFeedUpdate {
	update_num: number
}
