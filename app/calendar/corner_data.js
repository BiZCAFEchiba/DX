window.CORNER_CONTENT = {
  questionCategories: [
    { id: 'job-hunt', label: '就活関連', sortOrder: 10, published: true },
    { id: 'class', label: '単位・授業関連', sortOrder: 20, published: true },
    { id: 'other', label: 'その他', sortOrder: 30, published: true },
    { id: 'industry', label: '業界・企業関連', sortOrder: 40, published: true }
  ],
  worries: {
    title: 'スタッフがお悩み答えます!',
    note: 'カテゴリごとに、よくある質問とスタッフからのひとことをまとめています。',
    categories: [
      {
        id: 'worry-job-hunt',
        key: 'job-hunt',
        title: '就活関連',
        accent: 'career',
        published: true,
        sortOrder: 10,
        entries: [
          {
            id: 'worry-job-hunt-1',
            question: '自己分析はどこから始めるのがよいですか?',
            answer: 'まずはこれまで楽しかったことや大変だったことを3つほど書き出してみるのがおすすめです。',
            published: true,
            sortOrder: 10
          },
          {
            id: 'worry-job-hunt-2',
            question: 'インターンに参加していなくても大丈夫ですか?',
            answer: '大丈夫です。参加していない理由よりも、今から何を学ぶかの方が大事です。',
            published: true,
            sortOrder: 20
          }
        ]
      },
      {
        id: 'worry-class',
        key: 'class',
        title: '単位・授業関連',
        accent: 'study',
        published: true,
        sortOrder: 20,
        entries: [
          {
            id: 'worry-class-1',
            question: '授業と就活の両立が不安です。',
            answer: '学期の予定を先に見える化して、忙しい週を早めに把握しておくと調整しやすくなります。',
            published: true,
            sortOrder: 10
          }
        ]
      },
      {
        id: 'worry-other',
        key: 'other',
        title: 'その他何でも!!',
        accent: 'other',
        published: true,
        sortOrder: 30,
        entries: [
          {
            id: 'worry-other-1',
            question: 'BizCAFEはどんなときに使うのがおすすめですか?',
            answer: '一人で集中したいときにも、スタッフと気軽に話したいときにも使いやすい場所です。',
            published: true,
            sortOrder: 10
          }
        ]
      }
    ]
  },
  participation: {
    title: '参加型コーナー',
    prompt: 'みんなの声をちょっとずつ集めるコーナーです。',
    note: '公開中テーマをひとつ選んで投票できます。',
    stickyNote: '気になるテーマがあれば気軽に参加してみてください!',
    themes: []
  },
  staffColumns: {
    title: 'スタッフ紹介・コラム',
    staff: [
      {
        id: 'staff-1',
        name: 'Aoi',
        role: '3年 / 就活相談スタッフ',
        profile: '就活の進め方や自己分析の相談が得意です。まずは話しながら整理したい人向けです。',
        tags: ['就活', '自己分析'],
        published: true,
        sortOrder: 10
      },
      {
        id: 'staff-2',
        name: 'Riku',
        role: '4年 / 業界研究サポート',
        profile: '業界研究や企業比較の始め方を一緒に整理できます。',
        tags: ['業界研究', '企業比較'],
        published: true,
        sortOrder: 20
      }
    ],
    columns: [
      {
        id: 'column-1',
        title: 'BizCAFEスタッフが考える、就活の最初の一歩',
        body: 'まずは完璧を目指さず、気になることを言葉にしてみるだけでも前に進みます。',
        published: true,
        sortOrder: 10
      }
    ]
  }
};
