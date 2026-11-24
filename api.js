
export async function fetchQuote() {
    const response = await fetch("https://dummyjson.com/quotes/random");

    if (!response.ok) {
        throw new Error("Unable to fetch quote");
    }

    const data = await response.json();

    return {
        quote: data.quote,
        author: data.author
    };
}

export function fetchQuoteWithPromise() {
    return fetch("https://dummyjson.com/quotes/random")
        .then(response => {
            if (!response.ok) {
                throw new Error("Unable to fetch quote");
            }

            return response.json();
        })
        .then(data => ({
            quote: data.quote,
            author: data.author
        }));
}
