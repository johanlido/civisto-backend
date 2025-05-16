import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js";
Deno.serve(async (req)=>{
  try {
    const jsonObject = await req.json();
    const prompt = "You are incident handler with responsibility to handle reporting issues from customers. Provided json-data contains information regarding the issue. Relevant data are in: geo, image, weather, categories and comments. Your job is to respond to the issue and confirm with a very short summary if you are over 75% certain that you understand. If you are less than 75% certain, you need to respond with a short follow up question. Respond must be in json-respond-schema \
json-respond-schema: \
{ \
  '$schema': 'http://json-schema.org/draft-04/schema#', \
  'type': 'object', \
  'properties': { \
    'comment': { \
      'type': 'string' \
    }, \
    'probability': { \
      'type': 'integer' \
    } \
  }, \
  'required': [ \
    'comment', \
    'probability'\
  ] \
} \
json-data: " + JSON.stringify(jsonObject);
    const response = await fetch("https://api.openai.com/v1/engines/o4-mini/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`
      },
      body: JSON.stringify({
        prompt: prompt
      })
    });
    if (!response.ok) {
      const errorData = await response.json();
      console.error("OpenAI API error:", errorData);
      return new Response(JSON.stringify({
        error: "OpenAI API call failed",
        details: errorData
      }), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    const data = await response.json();
    // Defensive checks for OpenAI response structure
    const choices = data.choices;
    if (!choices || !choices[0] || !choices[0].message || typeof choices[0].message.content !== "string") {
      console.error("Unexpected OpenAI API response:", data);
      return new Response(JSON.stringify({
        error: "Unexpected OpenAI API response",
        details: data
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    const choicesText = choices[0].message.content;
    // Attempt to extract JSON from the response, fallback to plain comment
    let comment = choicesText;
    try {
      const jsonStartIndex = choicesText.lastIndexOf('{');
      if (jsonStartIndex !== -1) {
        const jsonString = choicesText.substring(jsonStartIndex);
        const parsedJson = JSON.parse(jsonString);
        if (parsedJson.comment) {
          comment = parsedJson.comment;
        }
      }
    } catch (jsonErr) {
      // If parsing fails, just use the plain text as comment
      console.warn("Failed to parse JSON from OpenAI response, using plain text.", jsonErr);
    }
    // Insert the JSON object into the t_tx table
    const supabaseClient = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"));
    const { error: insertError } = await supabaseClient.from("t_tx").insert([
      {
        user_id: 1,
        tx_doc: jsonObject
      }
    ]);
    if (insertError) {
      console.error("Database insert error:", insertError);
      return new Response(JSON.stringify({
        error: "Failed to insert data into the database",
        details: insertError
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    return new Response(JSON.stringify({
      comment
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
      }
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(JSON.stringify({
      error: "An unexpected error occurred",
      details: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});
