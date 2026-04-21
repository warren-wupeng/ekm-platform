import useSWR from 'swr'
import api from '@/lib/api'

export interface ApiPost {
  id: number
  author_id: number
  author_name: string
  title: string
  body: string
  reply_count: number
  like_count: number
  liked_by_me: boolean
  created_at: string | null
}

interface PostsResponse {
  page: number
  page_size: number
  total: number
  posts: ApiPost[]
}

async function fetchPosts(pageSize: number): Promise<PostsResponse> {
  const res = await api.get('/api/v1/posts', { params: { page_size: pageSize } })
  return res.data
}

export function usePosts(pageSize = 50) {
  const { data, isLoading, mutate } = useSWR<PostsResponse>(
    `posts/list/${pageSize}`,
    () => fetchPosts(pageSize),
    { dedupingInterval: 30_000, revalidateOnFocus: false },
  )

  async function likePost(id: number) {
    await api.put(`/api/v1/posts/${id}/like`)
    mutate((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        posts: prev.posts.map((p) =>
          p.id === id ? { ...p, liked_by_me: true, like_count: p.like_count + 1 } : p,
        ),
      }
    }, { revalidate: false })
  }

  async function unlikePost(id: number) {
    await api.delete(`/api/v1/posts/${id}/like`)
    mutate((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        posts: prev.posts.map((p) =>
          p.id === id ? { ...p, liked_by_me: false, like_count: Math.max(0, p.like_count - 1) } : p,
        ),
      }
    }, { revalidate: false })
  }

  return {
    posts: data?.posts ?? [],
    total: data?.total ?? 0,
    isLoading,
    likePost,
    unlikePost,
    mutate,
  }
}
