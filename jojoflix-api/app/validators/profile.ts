import vine from '@vinejs/vine'

const isoLanguageCode = vine.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/)

export const createProfileValidator = vine.create({
  name: vine.string().minLength(1).maxLength(100),
  avatar_url: vine.string().url().optional(),
  is_kids: vine.boolean().optional(),
})

export const updateProfileValidator = vine.create({
  name: vine.string().minLength(1).maxLength(100).optional(),
  avatar_url: vine.string().url().optional(),
  is_kids: vine.boolean().optional(),
  preferences: vine
    .object({
      audio: isoLanguageCode.optional(),
      subtitles: isoLanguageCode.optional(),
      auto_skip_intro: vine.boolean().optional(),
    })
    .optional(),
})
