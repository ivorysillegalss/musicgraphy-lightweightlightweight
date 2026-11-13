# AGENTS.md

## 1. 项目概述

Musicgraphy 是一个面向个人用户的轻量级音乐专辑记录与整理 Web 应用。

当前产品方向以「Personal Album Archive」为准：用户能够快速记录自己听过的专辑，并在未来通过搜索、筛选、标签和收藏重新找到它们。

本文件是给开发 Agent、Coding Agent 和维护者使用的工程约束文件。它不承担完整产品需求说明；产品目标、范围和交互原则以《Musicgraphy 2.0 宏观产品设计文档》为准。

## 2. 产品定位

Musicgraphy 不是：

- 音乐流媒体播放器
- 音乐推荐引擎
- Discogs 的专业唱片数据库
- 以地图为核心的音乐探索工具
- 社交音乐社区

Musicgraphy 是：

> 一个以「记录、整理、找回自己听过的专辑」为核心的个人音乐档案。

核心用户行为：

`搜索专辑 → 添加到 Collection → 标签/收藏/备注 → 搜索与筛选 → 再次找到`

所有新增功能都必须能够明确解释其对以下至少一个目标的贡献：

1. 更快地记录；
2. 更好地整理；
3. 更容易地找回；
4. 更好地回顾自己的音乐记录。

如果一个功能只增加视觉效果、技术复杂度或“音乐产品感”，但无法改善上述目标，应暂缓实现。

## 3. 当前产品范围

### MVP 必须支持

- 专辑搜索
- 搜索结果确认
- 添加专辑到 Collection
- Collection 专辑网格
- 专辑详情
- Favorite
- Tag
- Note
- Collection 内搜索
- 基础筛选
- Recently Added

### MVP 暂不实现

- 世界地图
- 地理聚类
- Discovery Pool
- 全局音乐推荐
- 强制评分体系
- Last.fm 自动同步
- Discogs 式版本/压制/库存管理
- 复杂后台管理
- 复杂统计 Dashboard

地图、时间轴和 Discovery 等旧 P2 能力不是当前架构必须保留的功能。

如果旧代码与新产品方向冲突，应优先保证新产品模型，而不是为了兼容旧实现继续扩大复杂度。

## 4. 数据原则

必须严格区分「外部音乐元数据」和「用户自己的记录」。

外部元数据包括：

- album title
- artist
- cover
- release year
- genres
- country 等

用户数据包括：

- favorite
- tags
- note
- addedAt
- listenedAt

外部元数据可以重新同步、修正或替换；用户数据必须被视为用户资产，任何同步机制都不得无条件覆盖。

数据库模型应优先围绕 Collection Record 建立，而不是围绕地图、地理实体或 Discovery Item 建立。

推荐概念关系：

`Album Metadata 1 --- N Collection Record`

即一个外部专辑实体可以被多个用户记录引用；如果当前产品暂时只有单用户，也不要因为简单而把所有 metadata 和 user state 混成一个不可分的数据对象。

## 5. 搜索原则

搜索是一级能力，不是 Collection 页面的附属功能。

用户可能只记得：

- 专辑名字的一部分
- 艺术家名字的一部分
- 大概年份
- genre
- 自己添加过的 tag
- 是否 Favorite

因此搜索系统应支持渐进式过滤，而不是要求用户输入完整精确标题。

优先保证：

`输入 → 快速出现候选 → 确认专辑 → 添加`

而不是构建复杂搜索语法。

## 6. Collection 原则

Collection 是产品核心页面。

默认展示应以专辑封面为主要视觉元素，并允许用户快速判断：

- 这是什么专辑；
- 谁的专辑；
- 是否已收藏；
- 是否已经记录。

默认排序建议：

`Recently Added`

后续可以支持：

- Oldest Added
- Release Year
- Artist
- Title
- Favorite

不要在 MVP 阶段引入大量排序方式。

## 7. Tag 原则

Genre 和 Tag 必须保持语义区分。

Genre 是外部 metadata。

Tag 是用户自己的认知体系。

例如：

- `夜晚`
- `通勤`
- `大学`
- `2026最爱`
- `循环`
- `冬天`

不要强迫用户把个人感受映射成标准 Genre。

Tag 应保持低成本输入。后续可以增加最近使用、自动补全、颜色等能力，但不能让 Tag 系统变成复杂的分类管理工具。

## 8. Favorite 与 Rating

MVP 优先使用 Favorite，而不是 1–10 分评分。

原因是当前产品首先解决「记录和找回」，不是建立精细的音乐评价体系。

如果未来引入 Rating，必须证明它能够产生明确的整理或回顾价值，而不是单纯复制其他音乐 App 的功能。

## 9. Topster

Topster 是 Collection 的一种展示方式，而不是独立的数据源。

正确关系：

`Collection → 选择专辑 → 创建 View → Topster`

不要设计成：

`Topster → 单独维护一套专辑数据`

Topster 应使用已有 Collection 数据，避免产生第二套状态。

典型场景：

- 2026 Favorites
- My Top 25
- 某个 Genre
- 某个 Tag
- 某段时间听过的专辑

## 10. 旧 P2 能力处理

旧 P2 中存在：

- 地图
- country / region / city
- geo cache
- geo clustering
- Discovery Pool
- sampling
- Last.fm import
- map collision
- 地理空间查询

这些能力可以保留为历史代码或未来实验，但不得反向决定新产品的核心数据模型。

未来如果重新引入地图，地图应当成为：

`Collection 的一种 View`

而不是产品首页，也不是主要 Discovery Engine。

## 11. 工程原则

### 优先简单

能通过普通查询完成的事情，不要引入复杂索引或独立服务。

能通过一个组件完成的 UI，不要提前抽象成复杂组件系统。

能通过数据库字段表达的状态，不要建立额外状态机。

### 不提前平台化

当前产品是个人记录型玩具，不需要为了“以后可能多人使用”提前建设：

- 微服务
- 复杂权限系统
- 消息队列
- 分布式缓存
- 搜索集群
- 复杂事件总线

### 不为 Agent 生成复杂架构

Coding Agent 修改代码时，禁止因为一次需求而顺带重构无关模块。

每次修改应尽量保持：

`需求 → 最小影响范围 → 最小实现 → 验证`

## 12. UI 工程原则

视觉目标是：

- cover-first
- lightweight
- playful
- personal archive
- low cognitive load

不要复制传统后台管理系统的视觉语言。

避免：

- 大量 Card 套 Card
- 复杂 Dashboard
- 过度使用 Badge
- 大量说明文字
- 多层 Sidebar
- 为每个 metadata 创建独立模块

专辑封面是核心视觉资产。

## 13. 页面边界

推荐信息架构：

- Collection
- Search
- Album Detail
- Tags / Filters

不要默认建立：

- Map
- Timeline
- Discovery
- Statistics
- Dashboard
- Geo
- Import

这些应该在验证核心 Collection 模式之后再考虑。

## 14. Agent 工作规则

开始修改代码前：

1. 阅读本文件。
2. 阅读相关产品设计文档。
3. 定位实际调用链。
4. 确认数据来源和状态边界。
5. 优先复用已有实现。
6. 不因局部需求修改无关模块。

完成修改后：

1. 检查 TypeScript 类型。
2. 检查 lint。
3. 检查构建。
4. 对涉及 API / DB 的改动检查数据兼容性。
5. 对 UI 改动检查 loading、empty、error 三种状态。
6. 不留下临时 debug 代码。

## 15. 完成标准

一个功能只有在以下条件同时满足时才算完成：

- 用户可以完成目标任务；
- 数据持久化正确；
- 刷新后状态仍然正确；
- loading / empty / error 状态合理；
- 不破坏 Collection 主流程；
- 没有引入不必要的新概念；
- 类型检查和构建通过。

## 16. 产品优先级

发生需求冲突时，按照以下顺序判断：

`Find → Record → Organize → Review → Discover`

其中 Find、Record 是最高优先级。

任何新功能如果削弱快速记录或后续找回能力，应谨慎接受。

